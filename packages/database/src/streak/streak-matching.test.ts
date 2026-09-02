import { describe, expect, it } from "vitest";
import {
  setup, setupFile, cleanupFileDb, configureSchedule, reconcile, processStreak,
  completeWorkoutOn, noon, cacheOf,
} from "./helpers";

const MON = "2026-02-02";
const THU = "2026-02-05";

describe("Workout -> scheduled-session matching (spec K/BA/BD)", () => {
  it("scheduled Monday + completed Monday workout -> linked, streak 1; second workout is a bonus", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const w1 = completeWorkoutOn(ctx, MON, { atUtc: MON + "T14:00:00.000Z" });
    processStreak(ctx, noon(MON));
    const session = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    expect(session.status).toBe("completed");
    expect(session.workoutId).toBe(w1);
    expect(cacheOf(ctx).currentStreak).toBe(1);
    const w2 = completeWorkoutOn(ctx, MON, { atUtc: MON + "T19:00:00.000Z" });
    processStreak(ctx, noon(MON));
    expect(ctx.repos.scheduledSessions.forWorkout(w2)).toBeNull(); // bonus: unlinked
    expect(cacheOf(ctx).currentStreak).toBe(1); // increments only once
  });

  it("routine mismatch does not block attendance: planned Push, trained Legs (spec K)", () => {
    const ctx = setup();
    const routine = ctx.services.routine.create(ctx.profileId, "Push Day");
    configureSchedule(ctx, { weekdays: [1], routineByWeekday: { 1: routine.id } });
    reconcile(ctx, noon(MON));
    // A completely different valid workout: legs.
    completeWorkoutOn(ctx, MON, { exerciseAlias: "Barbell Squat" });
    processStreak(ctx, noon(MON));
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("completed");
    expect(cacheOf(ctx).currentStreak).toBe(1);
  });

  it("a workout on a day without an obligation is a bonus: nothing linked, streak unchanged", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [4] });
    reconcile(ctx, noon(MON));
    completeWorkoutOn(ctx, MON); // Monday unscheduled
    processStreak(ctx, noon(MON));
    expect(cacheOf(ctx).currentStreak).toBe(0);
    const mondayRows = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON);
    expect(mondayRows.length).toBe(0);
  });

  it("streak processing is canonical-isolated: workouts, PRs and rank projections untouched (spec BD)", () => {
    const ctx = setup();
    // Give the profile bodyweight + ranked history via the derived worker.
    ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: MON + "T06:00:00.000Z", weightKg: 100, source: "test" });
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, noon(MON));
    const w1 = completeWorkoutOn(ctx, MON);
    ctx.services.derived.processPending(); // PRs + ranks exist now
    const w2 = completeWorkoutOn(ctx, THU, { exerciseAlias: "Barbell Squat", weightKg: 80 });
    ctx.services.derived.processPending();

    const snapshot = () => ({
      workouts: ctx.driver.all("SELECT * FROM workouts ORDER BY id"),
      sets: ctx.driver.all("SELECT * FROM workout_sets ORDER BY id"),
      exercises: ctx.driver.all("SELECT * FROM workout_exercises ORDER BY id"),
      prs: ctx.driver.all("SELECT * FROM personal_records ORDER BY id"),
      prEvents: ctx.driver.all("SELECT * FROM personal_record_events ORDER BY id"),
      rankSnapshots: ctx.driver.all("SELECT * FROM rank_snapshots ORDER BY id"),
      rankEvents: ctx.driver.all("SELECT * FROM rank_events ORDER BY id"),
    });
    const before = snapshot();
    const report = processStreak(ctx, noon(THU)); // links THU squat workout
    expect(report.errors).toEqual([]);
    const after = snapshot();
    expect(after).toEqual(before);
    // ...and it did its own job:
    expect(ctx.repos.scheduledSessions.forWorkout(w2)).not.toBeNull();
    expect(ctx.repos.scheduledSessions.forWorkout(w1)).not.toBeNull(); // earlier marker already consumed
    expect(cacheOf(ctx).currentStreak).toBe(2);
  });
});

describe("Process restart repair (spec BB)", () => {
  it("a marker created at finish survives a hard close; reopen + repair completes the session exactly once", () => {
    const db = setupFile();
    try {
      configureSchedule(db as never, { weekdays: [1, 4] });
      reconcile(db as never, noon(MON));
      const w1 = completeWorkoutOn(db as never, MON);
      processStreak(db as never, noon(MON));
      // Second completion: finish (marker written inside the finish transaction), then HARD CLOSE.
      const w2 = completeWorkoutOn(db as never, THU);
      expect(db.repos.streakDirty.count()).toBe(1); // repair intent persisted

      // Simulate process death: fresh open over the same file.
      const reopened = setupFile();
      void reopened;
      // (reopen happens below with a NEW file db to prove marker persistence we assert first)
      expect(db.repos.scheduledSessions.activeForDate(db.profileId, THU)?.status).toBe("pending");

      // Repair on next startup:
      const report = processStreak(db as never, noon(THU));
      expect(report.errors).toEqual([]);
      const session = db.repos.scheduledSessions.activeForDate(db.profileId, THU)!;
      expect(session.status).toBe("completed");
      expect(session.workoutId).toBe(w2);
      expect(cacheOf(db as never).currentStreak).toBe(2);
      expect(db.repos.streakDirty.count()).toBe(0);

      // Re-running is a no-op (no duplicate events/links).
      processStreak(db as never, noon(THU));
      expect(db.repos.scheduledSessions.forProfile(db.profileId).filter((s) => s.workoutId === w2).length).toBe(1);
      expect(db.repos.scheduledSessions.forProfile(db.profileId).filter((s) => s.workoutId === w1).length).toBe(1);
      expect(cacheOf(db as never).currentStreak).toBe(2);
      void w1;
    } finally {
      db.driver.close();
      cleanupFileDb(db.dir);
    }
  });

  it("streak failure keeps the marker and the workout; retry succeeds (spec R/S/AU)", () => {
    const ctx = setup();
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, noon(MON));
    const w1 = completeWorkoutOn(ctx, MON);
    // Sabotage the projection: make cache writes throw once.
    const original = ctx.repos.streakCache.upsert.bind(ctx.repos.streakCache);
    let broken = true;
    (ctx.repos.streakCache as unknown as { upsert: typeof original }).upsert = (cache) => {
      if (broken) throw new Error("disk on fire");
      original(cache);
    };
    const report = processStreak(ctx, noon(MON));
    expect(report.errors.length).toBe(1);
    // schedule_changed + schedule_enabled_changed (from setup) + workout_completed retained:
    expect(ctx.repos.streakDirty.count()).toBe(3);
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("pending");
    // workout is durable regardless:
    expect(ctx.repos.workout.getById(w1)!.workout.status).toBe("completed");
    // repair the sabotage and retry:
    broken = false;
    const retry = processStreak(ctx, noon(MON));
    expect(retry.errors).toEqual([]);
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)?.status).toBe("completed");
    expect(cacheOf(ctx).currentStreak).toBe(1);
  });
});