/**
 * Primary training reminders (specs A/AO/AM/L/Y) + permission gating (AN).
 *
 * Defining behavior: ZERO training reminders on rest days and for resolved
 * sessions. Reminders derive from scheduled_sessions only - one-off OS
 * notifications, never recurring weekly patterns.
 */

import { describe, expect, it } from "vitest";
import { configureSchedule, completeWorkoutOn, processStreak, reconcile } from "../streak/helpers";
import {
  enableReminders,
  reconcileNotifications,
  scheduledJobs,
  setupNotifications,
} from "./helpers";

const MON = "2026-02-09";
const TUE = "2026-02-10";
const WED = "2026-02-11";
const THU = "2026-02-12";
const clockAt = (d: string) => d + "T12:00:00.000Z";

describe("notification permission gating (spec AN)", () => {
  it("undetermined permission -> zero jobs, zero OS notifications", async () => {
    const ctx = setupNotifications(clockAt(THU));
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    const report = await reconcileNotifications(ctx);
    expect(report.permission).toBe("undetermined");
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("granted after request -> enabling reconciles jobs", async () => {
    const ctx = setupNotifications(clockAt(THU));
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    const status = await ctx.services.notifications.requestPermission(ctx.profileId);
    expect(status).toBe("granted");
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(1);
    expect(ctx.platform.count()).toBe(1);
  });

  it("denied -> nothing scheduled, schedule/streak/workout features unaffected", async () => {
    const ctx = setupNotifications(clockAt(THU));
    ctx.platform.requestPermissionResult = "denied";
    await ctx.services.notifications.requestPermission(ctx.profileId);
    expect(ctx.platform.permission).toBe("denied");
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    const report = await reconcileNotifications(ctx);
    expect(report.permission).toBe("denied");
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);

    // Core features keep working (spec AN/AB).
    completeWorkoutOn(ctx, MON, { atUtc: MON + "T18:00:00.000Z" });
    processStreak(ctx, MON + "T20:00:00.000Z", 0);
    expect(ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!.status).toBe("completed");
  });

  it("disabling reminders cancels future jobs", async () => {
    const ctx = setupNotifications(clockAt(THU));
    ctx.platform.permission = "granted";
    await ctx.services.notifications.requestPermission(ctx.profileId);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    ctx.services.notifications.updatePreferences(ctx.profileId, { trainingRemindersEnabled: false });
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });
});

describe("primary reminders (spec AO/AM)", () => {
  it("one scheduled session -> exactly one notification at the local reminder time", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1050 }); // 17:30
    await reconcileNotifications(ctx);

    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("training_primary");
    expect(jobs[0]!.scheduledFor).toBe(MON + "T17:30:00.000Z");
    expect(jobs[0]!.dedupeKey).toBe(jobs[0]!.scheduledSessionId + ":training_primary");
    expect(ctx.platform.count()).toBe(1);
  });

  it("3 training days -> reminders only on those days; Wednesday/Friday/etc get NONE", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1, 2, 4] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1020 });
    await reconcileNotifications(ctx);

    const forDates = scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10)).sort();
    expect(forDates).toEqual([MON, TUE, THU]); // 2026-02-11 (Wed) has NOTHING
    expect(ctx.platform.count()).toBe(3);
  });

  it("repeated reconcile never duplicates (app relaunch scenario)", async () => {
    const ctx = setupNotifications(clockAt(THU));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1, 4] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    await reconcileNotifications(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(2);
    expect(scheduledJobs(ctx)).toHaveLength(2);
  });

  it("completed session -> remaining future jobs cancelled (spec P)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1050 });
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    // Train at 18:45 (after the 17:30 primary fired).
    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: MON + "T18:45:00.000Z" });
    processStreak(ctx, MON + "T19:00:00.000Z", 0);
    await reconcileNotifications(ctx);
    expect(ctx.repos.scheduledSessions.forWorkout(workoutId)).not.toBeNull();
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("missed session -> no future job remains (spec R, no shame notification)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    // Day passes untrained; expiry marks missed on the next pass.
    ctx.clock.set(clockAt(TUE));
    reconcile(ctx, clockAt(TUE), 0);
    await reconcileNotifications(ctx);
    const missed = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    expect(missed.status).toBe("missed");
    // The missed obligation has ZERO jobs; the next week's own obligation
    // keeps its (correct) reminder - that is not a "nag".
    expect(scheduledJobs(ctx).some((j) => j.scheduledSessionId === missed.id)).toBe(false);
  });

  it("paused session -> zero reminders (spec S)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    ctx.services.schedule.addPause(ctx.profileId, MON, MON, "vacation", { todayUtc: clockAt(MON) });
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("cancelled session (schedule disabled) -> zero reminders (spec U)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false, { todayUtc: clockAt(MON) });
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("reminder time not configured for a day -> no reminder even when enabled", async () => {
    const ctx = setupNotifications(clockAt(THU));
    ctx.platform.permission = "granted";
    await ctx.services.notifications.requestPermission(ctx.profileId);
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    ctx.services.notifications.updatePreferences(ctx.profileId, { trainingRemindersEnabled: true });
    // no setReminderTimeForEnabledDays call: NULL minutes
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(0);
  });

  it("schedule disabled at the OS level (trainingRemindersEnabled but schedule.enabled=false) -> no reminders", async () => {
    const ctx = setupNotifications(clockAt(THU));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, false, { todayUtc: clockAt(THU) });
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(0);
  });
});

describe("reminder personalities (spec L/Y/M)", () => {
  it("normal style + routine name in copy", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    const routine = ctx.services.routine.create(ctx.profileId, "Push Day");
    configureSchedule(ctx, { weekdays: [1], routineByWeekday: { 1: routine.id } });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { style: "normal" });
    await reconcileNotifications(ctx);
    const summaries = ctx.platform.summaries();
    expect(summaries[0]).toContain("Training day");
    expect(summaries[0]!.split("|")[1]).toBe("Push Day is on your plan today.");
  });

  it("gentle / competitive styles keep stable, non-stale copy", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { style: "gentle" });
    await reconcileNotifications(ctx);
    expect(ctx.platform.summaries()[0]).toContain("Training is on your plan today");

    ctx.services.notifications.updatePreferences(ctx.profileId, { reminderStyle: "competitive" });
    await reconcileNotifications(ctx);
    const body = ctx.platform.summaries()[0]!.split("|")[1]!;
    expect(body).toContain("Diamond doesn't earn itself");
    // NO numeric streak counts in scheduled copy (spec M): nothing stale.
    expect(/[0-9]/.test(body)).toBe(false);
    expect(ctx.platform.count()).toBe(1); // style change replaced, not duplicated
  });

  it("early-morning reminder time maps to the NEXT calendar day (same logical day, spec F)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 60 }); // 01:00
    await reconcileNotifications(ctx);
    // Monday 01:00 is really Tuesday 01:00 - still Monday's logical day.
    expect(scheduledJobs(ctx)[0]!.scheduledFor).toBe(TUE + "T01:00:00.000Z");
  });

  it("WED session (reschedule target) is the only reminder day after a move (spec T)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx);
    await reconcileNotifications(ctx);
    const session = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    const sourceId = session.id;
    ctx.services.schedule.rescheduleSession(session.id, WED, { todayUtc: MON + "T10:00:00.000Z" });
    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    // The moved obligation carries exactly ONE reminder (now on Wednesday).
    const target = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, WED)!;
    const moved = jobs.filter((j) => j.scheduledSessionId === target.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.scheduledFor.slice(0, 10)).toBe(WED);
    // The moved-away source has no reminder of its own (moved, not duplicated).
    expect(jobs.some((j) => j.scheduledSessionId === sourceId)).toBe(false);
  });
});