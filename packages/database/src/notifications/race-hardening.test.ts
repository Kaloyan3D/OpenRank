/**
 * Phase 6 hardening (Phase 7 section 0 / spec AX): deterministic temporal
 * attendance semantics.
 *
 * Attendance outcome depends ONLY on the canonical timeline:
 * workout.finishedAt vs. the instant the obligation stopped being pending
 * (pending_until evidence). Processing order (immediate vs. deferred
 * worker) can no longer change the result.
 */

import { describe, expect, it } from "vitest";
import { configureSchedule, completeWorkoutOn, processStreak, reconcile } from "../streak/helpers";
import { cleanupFileDb, fixedClock, setupNotifications, setupNotificationsFile } from "./helpers";
import { createServices } from "../services";
import { openDatabase } from "../index";
import { NodeSqliteDriver } from "../node-driver";

const MON = "2026-02-09"; // Monday
const TUE = "2026-02-10";

/** Workout finished at 18:00 local (UTC offset 0 -> same instant). */
const FINISH = MON + "T18:00:00.000Z";
const DISABLE_AT = TUE + "T09:00:00.000Z";
/** Disable first, train afterwards (still Monday's logical day). */
const DISABLE_FIRST = MON + "T19:00:00.000Z";
const FINISH_AFTER = MON + "T21:00:00.000Z";
const TUE_NOON = TUE + "T12:00:00.000Z";

describe("phase 6 hardening: disable/processing race", () => {
  it("A: workout finished -> schedule disabled -> worker runs -> obligation COMPLETED", () => {
    const ctx = setupNotifications(DISABLE_AT);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0); // materialize Monday obligation while active

    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: FINISH }); // canonical finish at F
    ctx.clock.set(DISABLE_AT);
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false, { todayUtc: DISABLE_AT }); // cancels pending
    const cancelled = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(cancelled.status).toBe("cancelled"); // includes past-due pending
    expect(cancelled.pendingUntil).toBe(DISABLE_AT);

    processStreak(ctx, DISABLE_AT, 0); // deferred worker run
    const after = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(after.status).toBe("completed"); // valid at completion time
    expect(after.workoutId).toBe(workoutId);
    expect(after.pendingUntil).toBe(DISABLE_AT);
  });

  it("B: schedule disabled -> workout finished -> worker runs -> BONUS", () => {
    const ctx = setupNotifications(DISABLE_FIRST);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0);

    ctx.clock.set(DISABLE_FIRST);
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false, { todayUtc: DISABLE_FIRST });

    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: FINISH_AFTER }); // trained while disabled
    processStreak(ctx, DISABLE_FIRST, 0);
    const after = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(after.status).toBe("cancelled"); // never completed
    expect(ctx.repos.scheduledSessions.forWorkout(workoutId)).toBeNull(); // bonus: unlinked
    expect(ctx.repos.streakCache.get(ctx.profileId)?.currentStreak ?? 0).toBe(0);
    void workoutId;
  });

  it("C: processing before/after disable yields the SAME result for one canonical timeline", () => {
    // Timeline: workout F, disable T. Worker at F (before) vs. worker at T (after).
    const ctxEarly = setupNotifications(FINISH);
    configureSchedule(ctxEarly, { weekdays: [1] });
    reconcile(ctxEarly, FINISH, 0);
    const w1 = completeWorkoutOn(ctxEarly, MON, { atUtc: FINISH });
    processStreak(ctxEarly, FINISH, 0); // worker BEFORE disable
    ctxEarly.clock.set(DISABLE_AT);
    ctxEarly.services.schedule.setScheduleEnabled(ctxEarly.profileId, false, { todayUtc: DISABLE_AT });

    const ctxLate = setupNotifications(DISABLE_AT);
    configureSchedule(ctxLate, { weekdays: [1] });
    reconcile(ctxLate, FINISH, 0);
    const w2 = completeWorkoutOn(ctxLate, MON, { atUtc: FINISH });
    ctxLate.clock.set(DISABLE_AT);
    ctxLate.services.schedule.setScheduleEnabled(ctxLate.profileId, false, { todayUtc: DISABLE_AT });
    processStreak(ctxLate, DISABLE_AT, 0); // worker AFTER disable

    const early = ctxEarly.repos.scheduledSessions.forDate(ctxEarly.profileId, MON)[0]!;
    const late = ctxLate.repos.scheduledSessions.forDate(ctxLate.profileId, MON)[0]!;
    expect(early.status).toBe("completed");
    expect(late.status).toBe("completed");
    expect(late.workoutId).toBe(w2);
    expect(w1).toBeTruthy();
  });

  it("paused race: workout completed before the pause -> obligation completed, not paused", () => {
    const ctx = setupNotifications(DISABLE_AT);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0);
    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: FINISH });

    // Pause created AFTER the finish (covers the whole week), worker later.
    ctx.services.schedule.addPause(ctx.profileId, MON, TUE, null, { todayUtc: DISABLE_AT });
    ctx.services.schedule.reconcileUpcomingSessions(ctx.profileId, { todayUtc: DISABLE_AT });
    const paused = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(paused.status).toBe("paused");

    processStreak(ctx, DISABLE_AT, 0);
    const after = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(after.status).toBe("completed");
    expect(after.workoutId).toBe(workoutId);
  });

  it("expired race: workout finished inside the window, expiry processed first -> completed", () => {
    // Marker exists but the worker never ran; meanwhile the day window passed
    // and reconcileUpcomingSessions (e.g. app restart) expired the session.
    const ctx = setupNotifications(DISABLE_AT);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0);
    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: FINISH });

    reconcile(ctx, TUE_NOON, 0); // expiry pass: Monday pending -> missed (pending_until = now)
    const expired = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(expired.status).toBe("missed");

    processStreak(ctx, TUE_NOON, 0); // worker runs after expiry
    const after = ctx.repos.scheduledSessions.forDate(ctx.profileId, MON)[0]!;
    expect(after.status).toBe("completed");
    expect(after.workoutId).toBe(workoutId);
  });

  it("rescheduled sources stay neutral (user-declared move wins over completion timing)", () => {
    const ctx = setupNotifications(DISABLE_AT);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0);
    const session = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    // Move Monday's obligation to Wednesday BEFORE any workout exists.
    const moved = ctx.services.schedule.rescheduleSession(session.id, "2026-02-11", { todayUtc: FINISH, timezoneOffsetMinutes: 0 });
    void moved;
    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: FINISH });
    processStreak(ctx, FINISH, 0);
    // The Monday workout was a bonus: the user declared the obligation moved.
    expect(ctx.repos.scheduledSessions.forWorkout(workoutId)).toBeNull();
  });
});

describe("phase 6 hardening: restart safety", () => {
  it("file-db: hard restart between finish and worker keeps the same outcome", async () => {
    const ctx = setupNotificationsFile(DISABLE_AT);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, FINISH, 0);
    completeWorkoutOn(ctx, MON, { atUtc: FINISH });
    ctx.driver.close();

    const db2 = openAgain(ctx.dir);
    try {
      configureSchedule(db2, { weekdays: [1] });
      db2.services.schedule.setScheduleEnabled(db2.profileId, false, { todayUtc: DISABLE_AT });
      processStreak(db2, DISABLE_AT, 0);
      const after = db2.repos.scheduledSessions.forDate(db2.profileId, MON)[0]!;
      expect(after.status).toBe("completed");
    } finally {
      db2.driver.close();
      cleanupFileDb(ctx.dir);
    }
  });
});

function openAgain(dir: string) {
  const driver = new NodeSqliteDriver(dir + "/openrank.db");
  const repos = openDatabase(driver, {});
  const services = createServices(driver, repos, { now: fixedClock(DISABLE_AT) });
  const profile = repos.profile.ensureDefault();
  return { driver, repos, services, profileId: profile.id };
}