/**
 * Phase 8 analytics matrix: deterministic chart projections (bodyweight,
 * e1RM progression, rank timeline, weekly activity, volume breakdown) and
 * the achievement catalog. Analytics are pure projections - nothing here
 * may write canonical or derived state.
 */

import { describe, expect, it } from "vitest";
import { createServices, evaluateAchievements, ACHIEVEMENT_DEFINITIONS } from "../services";
import { openTestDb } from "../testing/helpers";

const NOW = "2026-02-16T12:00:00.000Z"; // a Monday

function fresh() {
  const db = openTestDb();
  const services = createServices(db.driver, db.repos, { now: () => NOW });
  Object.assign(services as unknown as Record<string, unknown>, { __repos: db.repos });
  return { ...db, services };
}

function supportedExerciseIds(services: ReturnType<typeof createServices>, n = 2): string[] {
  return dbRepos(services)
    .exercise.listRankSupported()
    .filter((e) => e.trackingType === "weight_reps")
    .slice(0, n)
    .map((e) => e.id);
}

type Services = ReturnType<typeof createServices>;
type Repos = ReturnType<typeof openTestDb>["repos"];

function dbRepos(services: Services): Repos {
  // createServices receives the OpenDatabaseResult verbatim; expose it for
  // catalog reads via a marker property attached in fresh() below.
  return (services as unknown as { __repos: Repos }).__repos;
}

/** Complete one workout with a single completed set (canonical flow). */
function logSetWorkout(
  services: Services,
  profileId: string,
  exerciseId: string,
  opts: { weightKg?: number; reps?: number; startedAtUtc?: string } = {},
): string {
  const workout = services.workout.startEmptyWorkout(profileId, {
    startedAtUtc: opts.startedAtUtc,
    timezoneOffsetMinutes: 0,
  });
  const we = dbRepos(services).workout.addExercise(workout.id, { exerciseId });
  const set = services.workout.addSet(we.id, {
    weightKg: opts.weightKg ?? 100,
    reps: opts.reps ?? 10,
    setType: "normal",
  });
  services.workout.completeSet(set.id);
  services.workout.finishWorkout(workout.id, { incompleteSetPolicy: "reject" });
  services.derived.processPending();
  return workout.id;
}

describe("Phase 8: bodyweight series", () => {
  it("A. empty profile -> empty series", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    expect(services.analytics.bodyweightSeries(profile.id)).toEqual([]);
  });

  it("B. measurements return chronological ascending with canonical kg", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    // bodyweight history is newest-first; the series must reverse it.
    // (Onboarding updates ITS measurement in place; history rows come from
    // explicit adds - here we exercise the history path directly.)
    dbRepos(services).bodyweight.add({ profileId: profile.id, measuredAt: "2026-02-01T12:00:00.000Z", weightKg: 80, source: "manual" });
    dbRepos(services).bodyweight.add({ profileId: profile.id, measuredAt: "2026-02-08T12:00:00.000Z", weightKg: 80.5, source: "manual" });
    dbRepos(services).bodyweight.add({ profileId: profile.id, measuredAt: "2026-02-15T12:00:00.000Z", weightKg: 81, source: "manual" });
    const series = services.analytics.bodyweightSeries(profile.id);
    expect(series.map((p) => p.weightKg)).toEqual([80, 80.5, 81]);
    expect(series[0]!.at < series[2]!.at).toBe(true);
  });
});

describe("Phase 8: e1RM progression", () => {
  it("C. no completed sets -> no points", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    expect(services.analytics.e1rmProgression(profile.id, "any-exercise")).toEqual([]);
  });

  it("D. PR events produce ascending best-progression points", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    services.profile.setOnboardingBodyweight(profile.id, 80, NOW);
    const exerciseId = supportedExerciseIds(services, 1)[0]!;

    logSetWorkout(services, profile.id, exerciseId, { weightKg: 60, reps: 8 });
    logSetWorkout(services, profile.id, exerciseId, { weightKg: 65, reps: 8 });

    const series = services.analytics.e1rmProgression(profile.id, exerciseId);
    expect(series.length).toBe(2);
    expect(series[0]!.e1rmKg).toBeLessThan(series[1]!.e1rmKg);
    expect(series[0]!.previousValue).toBeNull();
    expect(series[1]!.previousValue).toBe(series[0]!.e1rmKg);
  });
});

describe("Phase 8: rank timeline", () => {
  it("E. no ranks -> empty; ranked workouts -> ascending snapshot timeline", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    services.profile.setOnboardingBodyweight(profile.id, 80, NOW);
    const repos = dbRepos(services);
    const supported = repos.exercise.listRankSupported().find(
      (e) => e.trackingType === "weight_reps" && e.rankingGroup != null,
    )!;
    const group = supported.rankingGroup as string;

    expect(services.analytics.rankTimeline(profile.id, "muscle", group)).toEqual([]);

    logSetWorkout(services, profile.id, supported.id, { weightKg: 60, reps: 8 });
    logSetWorkout(services, profile.id, supported.id, { weightKg: 80, reps: 8 });

    const timeline = services.analytics.rankTimeline(profile.id, "muscle", group);
    expect(timeline.length).toBe(2);
    expect(timeline[0]!.at <= timeline[1]!.at).toBe(true);
    expect(timeline[1]!.score).toBeGreaterThanOrEqual(timeline[0]!.score);
    expect(timeline[0]!.tierName.length).toBeGreaterThan(0);
    expect(timeline[0]!.sourceWorkoutId).not.toBe(timeline[1]!.sourceWorkoutId);
  });
});

describe("Phase 8: weekly activity", () => {
  it("F. no workouts -> twelve all-zero buckets ending at the current ISO week", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    const buckets = services.analytics.weeklyActivity(profile.id, 12);
    expect(buckets.length).toBe(12);
    expect(buckets.every((b) => b.workouts === 0 && b.volumeKg === 0 && b.completedSets === 0)).toBe(true);
    expect(buckets[11]!.weekStart).toBe("2026-02-16"); // NOW is a Monday
  });

  it("G. workouts land in the correct ISO-week bucket with canonical volume", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    const exerciseId = supportedExerciseIds(services, 1)[0]!;

    logSetWorkout(services, profile.id, exerciseId, { startedAtUtc: "2026-02-16T09:00:00.000Z" });
    logSetWorkout(services, profile.id, exerciseId, { startedAtUtc: "2026-02-17T09:00:00.000Z" });
    logSetWorkout(services, profile.id, exerciseId, { startedAtUtc: "2026-02-09T09:00:00.000Z" });
    logSetWorkout(services, profile.id, exerciseId, { startedAtUtc: "2025-11-01T09:00:00.000Z" });

    const buckets = services.analytics.weeklyActivity(profile.id, 12);
    expect(buckets[11]!.workouts).toBe(2);
    expect(buckets[11]!.completedSets).toBe(2);
    expect(buckets[11]!.volumeKg).toBe(2000);
    expect(buckets[10]!.workouts).toBe(1);
    expect(buckets[10]!.volumeKg).toBe(1000);
    expect(buckets.reduce((acc, b) => acc + b.workouts, 0)).toBe(3); // window filters the rest
  });
});

describe("Phase 8: workout volume breakdown", () => {
  it("H. counts completed sets only, per exercise, in logged order", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    const ids = supportedExerciseIds(services, 2);
    const repos = dbRepos(services);
    const workout = services.workout.startEmptyWorkout(profile.id);
    const weA = repos.workout.addExercise(workout.id, { exerciseId: ids[0]! });
    const weB = repos.workout.addExercise(workout.id, { exerciseId: ids[1]! });
    const s1 = services.workout.addSet(weA.id, { weightKg: 100, reps: 10, setType: "normal" });
    const s2 = services.workout.addSet(weA.id, { weightKg: 100, reps: 10, setType: "normal" });
    services.workout.addSet(weB.id, { weightKg: 50, reps: 10, setType: "normal" });
    services.workout.completeSet(s1.id);
    services.workout.completeSet(s2.id);
    // weB set logged but NOT completed
    services.workout.finishWorkout(workout.id, { incompleteSetPolicy: "remove" });

    const slices = services.analytics.workoutVolumeBreakdown(workout.id);
    expect(slices.length).toBe(2);
    expect(slices[0]!.exerciseId).toBe(ids[0]);
    expect(slices[0]!.volumeKg).toBe(2000);
    expect(slices[0]!.completedSets).toBe(2);
    expect(slices[1]!.volumeKg).toBe(0);
    expect(slices[1]!.completedSets).toBe(0);
  });
});

describe("Phase 8: strength profile summary", () => {
  it("I. reports latest rank per group with history depth", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    expect(services.analytics.strengthProfileSummary(profile.id, new Map())).toEqual([]);
    services.profile.setOnboardingBodyweight(profile.id, 80, NOW);
    const supported = dbRepos(services).exercise.listRankSupported().find(
      (e) => e.trackingType === "weight_reps" && e.rankingGroup != null,
    )!;
    logSetWorkout(services, profile.id, supported.id, { weightKg: 100, reps: 5 });

    const summary = services.analytics.strengthProfileSummary(profile.id, new Map([["push", "Push"]]));
    expect(summary.length).toBeGreaterThan(0);
    const g = summary.find((s) => s.key === (supported.rankingGroup as string))!;
    expect(g).toBeDefined();
    expect(g.snapshotCount).toBe(1);
    expect(g.tierName).toBeTruthy();
  });
});

describe("Phase 8: achievements", () => {
  it("J. catalog integrity: unique ids, positive targets, known stat keys", () => {
    const ids = ACHIEVEMENT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const statKeys = [
      "completedWorkouts", "cumulativeVolumeKg", "personalRecords",
      "bestStreak", "rankedGroups", "bodyweightEntries",
    ];
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      expect(statKeys).toContain(def.stat);
      expect(def.target).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("K. empty stats -> nothing unlocked, progress 0", () => {
    const views = evaluateAchievements({
      completedWorkouts: 0, cumulativeVolumeKg: 0, personalRecords: 0,
      bestStreak: 0, rankedGroups: 0, bodyweightEntries: 0,
    });
    expect(views.length).toBe(ACHIEVEMENT_DEFINITIONS.length);
    expect(views.every((v) => !v.unlocked && v.progress === 0 && v.current === 0)).toBe(true);
  });

  it("L. thresholds and partial progress are exact", () => {
    const views = evaluateAchievements({
      completedWorkouts: 25, cumulativeVolumeKg: 5000, personalRecords: 30,
      bestStreak: 4, rankedGroups: 6, bodyweightEntries: 2,
    });
    const byId = new Map(views.map((v) => [v.id, v]));
    expect(byId.get("first_workout")!.unlocked).toBe(true);
    expect(byId.get("workouts_10")!.unlocked).toBe(true);
    expect(byId.get("workouts_25")!.unlocked).toBe(true);
    expect(byId.get("volume_10t")!.unlocked).toBe(false);
    expect(byId.get("volume_10t")!.progress).toBe(0.5);
    expect(byId.get("volume_100t")!.progress).toBe(0.05);
    expect(byId.get("first_pr")!.unlocked).toBe(true);
    expect(byId.get("prs_25")!.unlocked).toBe(true);
    expect(byId.get("streak_4")!.unlocked).toBe(true);
    expect(byId.get("streak_12")!.unlocked).toBe(false);
    expect(byId.get("first_rank")!.unlocked).toBe(true);
    expect(byId.get("all_six_ranks")!.unlocked).toBe(true);
    expect(byId.get("bodyweight_logged")!.unlocked).toBe(true);
  });

  it("M. integration: real activity flows into the achievement view", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    services.profile.setOnboardingBodyweight(profile.id, 80, NOW);
    expect(services.achievements.list(profile.id).find((a) => a.id === "first_workout")!.unlocked).toBe(false);

    const exerciseId = supportedExerciseIds(services, 1)[0]!;
    logSetWorkout(services, profile.id, exerciseId, { weightKg: 100, reps: 10 });

    const after = services.achievements.list(profile.id);
    expect(after.find((a) => a.id === "first_workout")!.unlocked).toBe(true);
    expect(after.find((a) => a.id === "first_pr")!.unlocked).toBe(true);
    expect(after.find((a) => a.id === "volume_10t")!.current).toBe(1000);
    expect(after.find((a) => a.id === "bodyweight_logged")!.unlocked).toBe(true);
    expect(after.filter((a) => a.unlocked).length).toBe(4);
  });

  it("N. projection never writes: repeated evaluation is stable and side-effect free", () => {
    const { services } = fresh();
    const { profile } = services.profile.createLocalProfile({ displayName: "K" });
    const exerciseId = supportedExerciseIds(services, 1)[0]!;
    logSetWorkout(services, profile.id, exerciseId);

    const first = services.achievements.list(profile.id);
    const second = services.achievements.list(profile.id);
    expect(second).toEqual(first);
    expect(services.workout.listHistory(profile.id).length).toBe(1);
    expect(services.analytics.weeklyActivity(profile.id).reduce((a, b) => a + b.workouts, 0)).toBe(1);
  });
});
