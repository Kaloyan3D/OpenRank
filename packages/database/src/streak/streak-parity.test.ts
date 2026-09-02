import { describe, expect, it } from "vitest";
import {
  setup, configureSchedule, reconcile, processStreak, completeWorkoutOn, noon, setupFile, cleanupFileDb,
} from "./helpers";

const MON = "2026-02-02";
const TUE = "2026-02-03";
const THU = "2026-02-05";
const FRI = "2026-02-06";
const MON2 = "2026-02-09";
const WED2 = "2026-02-11";
const THU2 = "2026-02-12";

/** Representative mixed history: completions, a miss, a pause, a reschedule. */
function buildHistory(ctx: ReturnType<typeof setup>): void {
  configureSchedule(ctx, { weekdays: [1, 2, 4] });
  // Week 1: all three completed.
  reconcile(ctx, noon(MON));
  for (const d of [MON, TUE, THU]) {
    completeWorkoutOn(ctx, d, { weightKg: 60, reps: 5 });
    processStreak(ctx, noon(d));
  }
  // Week 2: Monday completed, Tuesday missed (advance past it), Thursday completed.
  reconcile(ctx, noon(MON2));
  completeWorkoutOn(ctx, MON2);
  processStreak(ctx, noon(MON2));
  processStreak(ctx, noon(WED2)); // Tuesday expires -> missed
  reconcile(ctx, noon(THU2));
  completeWorkoutOn(ctx, THU2);
  processStreak(ctx, noon(THU2));
}

function projectionSnapshot(ctx: ReturnType<typeof setup>) {
  return {
    cache: ctx.repos.streakCache.get(ctx.profileId),
    events: ctx.repos.streakEvents.listForProfile(ctx.profileId).map((e) => ({
      type: e.type, key: e.key, value: e.value, occurredAt: e.occurredAt,
    })),
    sessionMarks: ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => ({
      id: s.id, scheduledDate: s.scheduledDate, status: s.status, streakAfter: s.streakAfter, workoutId: s.workoutId,
    })),
  };
}

describe("Incremental == rebuild (spec BC/T)", () => {
  it("rebuild over processed history reproduces the identical projection", () => {
    const ctx = setup();
    buildHistory(ctx);
    const before = projectionSnapshot(ctx);
    expect(before.cache!.currentStreak).toBe(1);
    expect(before.cache!.bestStreak).toBe(4);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    const after = projectionSnapshot(ctx);
    expect(after).toEqual(before);
  });

  it("rebuild-only database equals the incrementally-processed database", () => {
    const incremental = setup();
    buildHistory(incremental);

    const rebuildOnly = setup();
    buildHistory(rebuildOnly);
    // Wipe ALL projection state; rebuild from the ledger alone.
    rebuildOnly.driver.run("DELETE FROM streak_cache");
    rebuildOnly.driver.run("DELETE FROM streak_events");
    rebuildOnly.driver.run("UPDATE scheduled_sessions SET streak_after = NULL");
    rebuildOnly.services.streak.rebuildAllStreakState(rebuildOnly.profileId);

    expect(projectionSnapshot(rebuildOnly)).toEqual(projectionSnapshot(incremental));
  });

  it("repeat rebuilds are stable: same result, same history, no duplicate events", () => {
    const ctx = setup();
    buildHistory(ctx);
    const once = projectionSnapshot(ctx);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    const twice = projectionSnapshot(ctx);
    ctx.services.streak.rebuildAllStreakState(ctx.profileId);
    const thrice = projectionSnapshot(ctx);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it("full ledger (incl. linked workouts and reschedule provenance) survives a rebuild-only wipe", () => {
    const db = setupFile();
    try {
      const ctx = db;
      configureSchedule(ctx as never, { weekdays: [1, 2, 4] });
      reconcile(ctx as never, noon(MON));
      completeWorkoutOn(ctx as never, MON);
      processStreak(ctx as never, noon(MON));
      // Reschedule Thursday to Friday within the week.
      ctx.services.schedule.rescheduleSession(
        ctx.repos.scheduledSessions.activeForDate(ctx.profileId, THU)!.id, FRI, { todayUtc: noon(MON) },
      );
      completeWorkoutOn(ctx as never, FRI);
      processStreak(ctx as never, noon(FRI));
      const before = projectionSnapshot(ctx as never);
      expect(before.sessionMarks.filter((s) => s.scheduledDate === FRI && s.status === "completed").length).toBe(1);
      expect(before.sessionMarks.filter((s) => s.scheduledDate === THU && s.status === "rescheduled").length).toBe(1);

      ctx.driver.run("DELETE FROM streak_cache");
      ctx.driver.run("DELETE FROM streak_events");
      ctx.driver.run("UPDATE scheduled_sessions SET streak_after = NULL");
      ctx.services.streak.rebuildAllStreakState(ctx.profileId);
      expect(projectionSnapshot(ctx as never)).toEqual(before);
    } finally {
      db.driver.close();
      cleanupFileDb(db.dir);
    }
  });
});