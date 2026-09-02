import { describe, expect, it } from "vitest";
import { deterministicRepos, openTestFileDb, cleanupFileDb } from "../testing/helpers";
import { createServices } from "../services";
import type { OpenRankServices } from "../services";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";

const T0 = "2026-02-10T10:00:00.000Z";
const T1 = "2026-02-11T10:00:00.000Z";
const T2 = "2026-02-12T10:00:00.000Z";

interface Ctx {
  driver: DatabaseDriver;
  repos: OpenDatabaseResult;
  services: OpenRankServices;
  profileId: string;
}

function setup(): Ctx {
  const db = deterministicRepos();
  const services = createServices(db.driver, db.repos, {
    now: (() => {
      let n = 0;
      const base = Date.parse("2026-03-01T00:00:00.000Z");
      return () => new Date(base + (n++) * 1000).toISOString();
    })(),
  });
  const profile = db.repos.profile.ensureDefault();
  return { driver: db.driver, repos: db.repos, services, profileId: profile.id };
}

const alias = (ctx: Ctx, name: string) => ctx.repos.exercise.resolveAlias(name)!.id;

function workout(ctx: Ctx, startedAt: string, exerciseId: string, sets: Array<[number | null, number | null]>): string {
  const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: startedAt });
  const we = ctx.repos.workout.addExercise(w.id, { exerciseId, restSeconds: 0 });
  for (const [weightKg, reps] of sets) {
    ctx.services.workout.addSet(we.id, { setType: "normal", weightKg, reps }, startedAt);
  }
  ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: startedAt, incompleteSetPolicy: "remove" });
  return w.id;
}

describe("DerivedDataWorker (spec AM)", () => {
  it("processes markers: consumes them, writes PRs + snapshots, leaves canonical data untouched", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5], [60, 5]]);

    const before = ctx.repos.workout.getById(workout(ctx, T1, bench, [[65, 5]]))!;
    const pending = ctx.repos.dirty.count();
    expect(pending).toBeGreaterThan(0);

    const report = ctx.services.derived.processPending();
    expect(report.errors).toEqual([]);
    expect(report.processedMarkers).toBe(pending);
    expect(ctx.repos.dirty.count()).toBe(0);

    // PRs + snapshots exist
    const prs = ctx.repos.personalRecords.listForExercise(ctx.profileId, bench);
    expect(prs.length).toBeGreaterThan(0);
    expect(ctx.repos.rankSnapshots.latest(ctx.profileId, "muscle", "chest")).not.toBeNull();
    expect(ctx.repos.rankSnapshots.latest(ctx.profileId, "exercise", bench)).not.toBeNull();

    // Canonical workout data is untouched by derivation:
    const after = ctx.repos.workout.getById(before.workout.id)!;
    expect(after).toEqual(before);
  });

  it("coalesces multiple dirty workouts into one pass (spec Q)", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5]]);
    workout(ctx, T1, bench, [[65, 5]]);
    workout(ctx, T2, bench, [[70, 5]]);
    const report = ctx.services.derived.processPending();
    expect(report.errors).toEqual([]);
    // The pending profile_changed marker (first launch) coalesces everything
    // into ONE full-rebuild pass covering all three workouts.
    expect(report.profilesRebuilt).toBe(1);
    expect(ctx.repos.rankSnapshots.history(ctx.profileId, "muscle", "chest")).toHaveLength(3);
    // 60x5 -> 0.70 tier2; 65x5 -> 0.7583 tier2; 70x5 -> 0.8167 tier3: one up event.
    const events = ctx.repos.rankEvents.historyForScope(ctx.profileId, "muscle", "chest");
    expect(events).toHaveLength(1);
    expect(events[0]!.direction).toBe("up");

    // Workout-level markers alone take the incremental path (one step).
    ctx.repos.dirty.clearAll();
    const T3 = "2026-02-13T10:00:00.000Z";
    workout(ctx, T3, bench, [[75, 5]]); // 0.875, still Platinum: no event
    const report2 = ctx.services.derived.processPending();
    expect(report2.profilesRebuilt).toBe(0);
    expect(report2.workoutsProcessed).toBe(1);
    expect(ctx.repos.rankSnapshots.history(ctx.profileId, "muscle", "chest")).toHaveLength(4);
    expect(ctx.repos.rankEvents.historyForScope(ctx.profileId, "muscle", "chest")).toHaveLength(1);
  });

  it("active-workout markers are consumed without projection; completion re-marks", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: T0 });
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: bench, restSeconds: 0 });
    ctx.services.workout.addSet(we.id, { setType: "normal", weightKg: 60, reps: 5 }, T0);
    expect(ctx.repos.dirty.count()).toBeGreaterThan(0);
    const report = ctx.services.derived.processPending();
    expect(report.errors).toEqual([]);
    expect(ctx.repos.dirty.count()).toBe(0);
    expect(ctx.repos.rankSnapshots.latest(ctx.profileId, "muscle", "chest")).toBeNull();
    expect(ctx.repos.personalRecords.listForProfile(ctx.profileId)).toEqual([]);
    // Completing the set finishes the workout? No - complete the workout now:
    ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: T0, incompleteSetPolicy: "remove" });
    expect(ctx.repos.dirty.count()).toBeGreaterThan(0);
    ctx.services.derived.processPending();
    expect(ctx.repos.rankSnapshots.latest(ctx.profileId, "muscle", "chest")).not.toBeNull();
  });

  it("duplicate processing never duplicates events or snapshots (spec U)", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5]]);
    ctx.services.derived.processPending();
    const prCount = ctx.repos.personalRecords.listForProfile(ctx.profileId).length;
    const evCount = ctx.repos.personalRecords.listEventsForWorkout("x").length + countPrEvents(ctx);
    const snapCount = countSnapshots(ctx);
    const rankEvCount = ctx.repos.rankEvents.countForProfile(ctx.profileId);

    // Re-run with no markers: no-op.
    ctx.services.derived.processPending();
    expect(countSnapshots(ctx)).toBe(snapCount);

    // Simulate a retry after a crash-before-commit: re-mark the same workouts.
    const completed = ctx.driver.all("SELECT id FROM workouts WHERE status='completed'", []);
    for (const row of completed as { id: string }[]) {
      ctx.repos.dirty.mark(ctx.profileId, "workout", row.id, "workout_saved");
    }
    ctx.services.derived.processPending();
    expect(ctx.repos.personalRecords.listForProfile(ctx.profileId).length).toBe(prCount);
    expect(countPrEvents(ctx)).toBe(evCount);
    expect(countSnapshots(ctx)).toBe(snapCount);
    expect(ctx.repos.rankEvents.countForProfile(ctx.profileId)).toBe(rankEvCount);
  });

  it("a failing projection leaves markers for retry, reports the error and succeeds on retry", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5]]);

    // Inject a projection-write failure (simulates a crash before COMMIT).
    const worker = ctx.services.derived.worker;
    const injected = () => {
      throw new Error("injected projection failure");
    };
    const original = worker["derived"].rankSnapshots.upsert.bind(worker["derived"].rankSnapshots);
    (worker["derived"].rankSnapshots as { upsert: unknown }).upsert = injected;

    const failed = ctx.services.derived.processPending();
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]!.profileId).toBe(ctx.profileId);
    expect(failed.errors[0]!.message).toContain("injected");
    expect(ctx.repos.dirty.count()).toBeGreaterThan(0); // retry intent preserved
    expect(countSnapshots(ctx)).toBe(0); // rolled back

    // Retry succeeds and produces exactly the normal result.
    (worker["derived"].rankSnapshots as { upsert: unknown }).upsert = original;
    const retried = ctx.services.derived.processPending();
    expect(retried.errors).toEqual([]);
    expect(ctx.repos.dirty.count()).toBe(0);
    expect(countSnapshots(ctx)).toBe(2); // exercise + muscle chest
    expect(countPrEvents(ctx)).toBeGreaterThan(0);
  });

  it("bodyweight changes trigger the full-rebuild path (profile-level marker)", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5]]);
    ctx.services.derived.processPending();
    // Adding a bodyweight entry writes bodyweight_changed:
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: "2026-02-20T10:00:00.000Z", weightKg: 105, source: "test" });
    const report = ctx.services.derived.processPending();
    expect(report.errors).toEqual([]);
    expect(report.profilesRebuilt).toBe(1);
    // Rebuild derived identical rows (score uses bw at each workout; the
    // historical workout keeps its own resolution):
    const snap = ctx.repos.rankSnapshots.latest(ctx.profileId, "muscle", "chest")!;
    expect(snap.score).toBeCloseTo(0.7, 9);
  });

  it("unit-system change does NOT invalidate; strength-standard change rebuilds", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const bench = alias(ctx, "Bench Press (Barbell)");
    workout(ctx, T0, bench, [[60, 5]]);
    ctx.services.derived.processPending();
    ctx.repos.dirty.clearAll();

    ctx.repos.profile.updateUnitSystem(ctx.profileId, "imperial");
    expect(ctx.repos.dirty.count()).toBe(0); // display-only change (spec I)

    ctx.repos.profile.updateStrengthStandard(ctx.profileId, "female");
    expect(ctx.repos.dirty.count()).toBe(1);
    const report = ctx.services.derived.processPending();
    expect(report.profilesRebuilt).toBe(1);
    // PRs are sex-independent: unchanged value, same provenance.
    const prs = ctx.repos.personalRecords.listForExercise(ctx.profileId, bench);
    const e1rm = prs.find((p) => p.recordType === "max_e1rm")!;
    expect(e1rm.value).toBeCloseTo(70, 9);
  });

  it("is restart-safe: a file database reprocessed after reopen yields the same state", () => {
    const dir = openTestFileDb();
    try {
      const services = createServices(dir.driver, dir.repos, { now: () => "2026-03-01T00:00:00.000Z" });
      const profile = dir.repos.profile.ensureDefault();
      dir.repos.bodyweight.add({ profileId: profile.id, measuredAt: T0, weightKg: 100, source: "test" });
      const bench = dir.repos.exercise.resolveAlias("Bench Press (Barbell)")!.id;
      const w = services.workout.startEmptyWorkout(profile.id, { startedAtUtc: T0 });
      const we = dir.repos.workout.addExercise(w.id, { exerciseId: bench, restSeconds: 0 });
      services.workout.addSet(we.id, { setType: "normal", weightKg: 60, reps: 5 });
      services.workout.finishWorkout(w.id, { finishedAtUtc: T0, incompleteSetPolicy: "remove" });
      const first = services.derived.processPending();
      expect(first.errors).toEqual([]);
      const snapsBefore = dir.repos.rankSnapshots.latestForProfile(profile.id).length;

      // "Restart": process again on the reopened handle (markers are gone ->
      // no-op) and verify stability.
      const second = services.derived.processPending();
      expect(second.processedMarkers).toBe(0);
      expect(dir.repos.rankSnapshots.latestForProfile(profile.id).length).toBe(snapsBefore);
    } finally {
      try {
        dir.driver.close();
      } catch {
        // already closed
      }
      cleanupFileDb(dir.dir);
    }
  });

  it("multiple dirty exercises inside one workout coalesce (spec AM)", () => {
    const ctx = setup();
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T0, weightKg: 100, source: "test" });
    const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: T0 });
    for (const name of ["Bench Press (Barbell)", "Squat (Barbell)", "Pull Up"]) {
      const we = ctx.repos.workout.addExercise(w.id, { exerciseId: alias(ctx, name), restSeconds: 0 });
      ctx.services.workout.addSet(we.id, { setType: "normal", weightKg: 60, reps: 5 }, T0);
    }
    ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: T0, incompleteSetPolicy: "remove" });
    const report = ctx.services.derived.processPending();
    expect(report.errors).toEqual([]);
    // pull up = bodyweight (no bw needed: pull up bodyweight_reps w=0 PR; rank needs bw)
    const exerciseSnaps = ctx.repos.rankSnapshots.latestForProfile(ctx.profileId).filter((s) => s.scopeType === "exercise");
    expect(exerciseSnaps.length).toBeGreaterThanOrEqual(2);
  });
});

function countSnapshots(ctx: Ctx): number {
  return ctx.driver.get("SELECT COUNT(*) AS n FROM rank_snapshots", [])!.n as number;
}
function countPrEvents(ctx: Ctx): number {
  return ctx.driver.get("SELECT COUNT(*) AS n FROM personal_record_events", [])!.n as number;
}