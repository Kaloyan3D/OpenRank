import { describe, expect, it } from "vitest";
import { deterministicRepos } from "../testing/helpers";
import { RankingInputBuilder } from "./ranking-input";
import { createServices } from "../services";
import { GROUPS } from "@openrank/ranking-core";

function setup() {
  const db = deterministicRepos();
  const services = createServices(db.driver, db.repos, { now: () => "2026-03-01T10:00:00.000Z" });
  const profile = db.repos.profile.ensureDefault();
  return { ...db, ...services, profile };
}

function finishBenchSquatWorkout(
  ctx: ReturnType<typeof setup>,
  startedAt: string,
  entries: Array<{ name: string; sets: Array<{ weightKg: number | null; reps: number | null }> }>,
): string {
  const w = ctx.workout.startEmptyWorkout(ctx.profile.id, { startedAtUtc: startedAt });
  for (const entry of entries) {
    const ex = ctx.repos.exercise.resolveAlias(entry.name)!;
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: ex.id, restSeconds: 90 });
    for (const s of entry.sets) ctx.workout.addSet(we.id, { setType: "normal", weightKg: s.weightKg, reps: s.reps }, startedAt);
  }
  ctx.workout.finishWorkout(w.id, { finishedAtUtc: startedAt, incompleteSetPolicy: "remove" });
  return w.id;
}

describe("RankingInputBuilder (spec G)", () => {
  it("includes only completed workouts, chronological, day-granular dates", () => {
    const ctx = setup();
    finishBenchSquatWorkout(ctx, "2026-02-10T10:00:00.000Z", [
      { name: "Bench Press (Barbell)", sets: [{ weightKg: 60, reps: 5 }] },
    ]);
    finishBenchSquatWorkout(ctx, "2026-02-12T10:00:00.000Z", [
      { name: "Squat (Barbell)", sets: [{ weightKg: 100, reps: 5 }] },
    ]);
    // An ACTIVE workout (with a completed set!) must be excluded:
    const active = ctx.workout.startEmptyWorkout(ctx.profile.id, { startedAtUtc: "2026-02-11T10:00:00.000Z" });
    const we = ctx.repos.workout.addExercise(active.id, { exerciseId: ctx.repos.exercise.resolveAlias("Squat (Barbell)")!.id, restSeconds: 0 });
    ctx.workout.addSet(we.id, { setType: "normal", weightKg: 200, reps: 5 }, "2026-02-11T10:05:00.000Z");
    const build = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "rankable");
    expect(build.sessionWorkoutIds).toHaveLength(2);
    expect(build.sessionWorkoutIds).not.toContain(active.id);
    expect(build.sessions[0]!.date).toBe("2026-02-10");
    expect(build.sessions[1]!.date).toBe("2026-02-12");
    ctx.workout.discardWorkout(active.id);
  });

  it("excludes warmup sets and incomplete sets", () => {
    const ctx = setup();
    const w = ctx.workout.startEmptyWorkout(ctx.profile.id, { startedAtUtc: "2026-02-10T10:00:00.000Z" });
    const startedAt = "2026-02-10T10:05:00.000Z";
    const bench = ctx.repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: bench.id, restSeconds: 0 });
    ctx.workout.addSet(we.id, { setType: "warmup", weightKg: 40, reps: 10 }, startedAt);
    ctx.workout.addSet(we.id, { setType: "normal", weightKg: 60, reps: 5 }, startedAt);
    ctx.workout.addSet(we.id, { setType: "normal", weightKg: 80, reps: 5 }); // stays incomplete
    ctx.workout.finishWorkout(w.id, { finishedAtUtc: "2026-02-10T11:00:00.000Z", incompleteSetPolicy: "remove" });
    const build = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "rankable");
    expect(build.sessions).toHaveLength(1);
    const sets = build.sessions[0]!.exercises[0]!.sets;
    expect(sets).toHaveLength(1); // warmup + incomplete dropped
    expect(sets[0]).toEqual({ weight: 60, reps: 5, type: "normal" });
  });

  it("filters eligibility: unsupported excluded, provisional only in rankable pass", () => {
    const ctx = setup();
    // find one provisional chest/legs exercise in the seeded catalog
    const provRow = ctx.driver.get(
      "SELECT id, name, ranking_group FROM exercises WHERE ranking_eligibility = 'provisional' AND ranking_group IS NOT NULL LIMIT 1",
      [],
    ) as { id: string; name: string; ranking_group: string } | undefined;
    expect(provRow).toBeDefined();
    const custom = ctx.repos.exercise.createCustom({
      name: "Mystery Machine",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
    });
    const w = ctx.workout.startEmptyWorkout(ctx.profile.id, { startedAtUtc: "2026-02-10T10:00:00.000Z" });
    const startedAt = "2026-02-10T10:05:00.000Z";
    const we1 = ctx.repos.workout.addExercise(w.id, { exerciseId: provRow!.id, restSeconds: 0 });
    ctx.workout.addSet(we1.id, { setType: "normal", weightKg: 50, reps: 5 }, startedAt);
    const we2 = ctx.repos.workout.addExercise(w.id, { exerciseId: custom.id, restSeconds: 0 });
    ctx.workout.addSet(we2.id, { setType: "normal", weightKg: 50, reps: 5 }, startedAt);
    ctx.workout.finishWorkout(w.id, { finishedAtUtc: "2026-02-10T11:00:00.000Z", incompleteSetPolicy: "remove" });

    const rankable = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "rankable");
    const eligibleOnly = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "eligible_only");
    expect(rankable.sessions[0]!.exercises).toHaveLength(1); // provisional in
    expect(eligibleOnly.sessions[0]!.exercises).toHaveLength(0); // provisional out
    expect(rankable.titleToExercise.has(custom.name)).toBe(false); // unsupported out
  });

  it("maps engine titles to exercises and synthesizes templates from the stored engine group", () => {
    const ctx = setup();
    finishBenchSquatWorkout(ctx, "2026-02-10T10:00:00.000Z", [
      { name: "Bench Press (Barbell)", sets: [{ weightKg: 60, reps: 5 }] },
    ]);
    const build = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "rankable");
    const canonicalName = ctx.repos.exercise.resolveAlias("Bench Press (Barbell)")!.name;
    const info = build.titleToExercise.get(canonicalName)!;
    expect(info).toBeDefined();
    expect(info.engineGroup).toBe("chest");
    expect(build.ambiguousTitles.size).toBe(0);
    // The catalog template for this exercise routes through the chest group:
    const cfg = GROUPS[info.engineGroup as keyof typeof GROUPS]!;
    expect(cfg.primaries.length).toBeGreaterThan(0);
  });

  it("is deterministic: identical canonical state produces identical output", () => {
    const a = setup();
    const b = setup();
    const entries = [{ name: "Bench Press (Barbell)", sets: [{ weightKg: 60, reps: 5 }, { weightKg: 62.5, reps: 5 }] }];
    finishBenchSquatWorkout(a, "2026-02-10T10:00:00.000Z", entries);
    finishBenchSquatWorkout(b, "2026-02-10T10:00:00.000Z", entries);
    const ba = new RankingInputBuilder(a.driver).build(a.profile.id, "rankable");
    const bb = new RankingInputBuilder(b.driver).build(b.profile.id, "rankable");
    expect(ba.sessions).toEqual(bb.sessions);
    expect([...ba.titleToExercise.entries()]).toEqual([...bb.titleToExercise.entries()]);
  });

  it("flags rank-relevant workouts for the worker skip optimization", () => {
    const ctx = setup();
    const w = ctx.workout.startEmptyWorkout(ctx.profile.id, { startedAtUtc: "2026-02-10T10:00:00.000Z" });
    const startedAt = "2026-02-10T10:05:00.000Z";
    const custom = ctx.repos.exercise.createCustom({
      name: "Only Custom",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
    });
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: custom.id, restSeconds: 0 });
    ctx.workout.addSet(we.id, { setType: "normal", weightKg: 60, reps: 5 }, startedAt);
    ctx.workout.finishWorkout(w.id, { finishedAtUtc: "2026-02-10T11:00:00.000Z", incompleteSetPolicy: "remove" });
    const build = new RankingInputBuilder(ctx.driver).build(ctx.profile.id, "rankable");
    expect(build.workoutHasRankRelevantSets.get(w.id)).toBe(false);
  });
});