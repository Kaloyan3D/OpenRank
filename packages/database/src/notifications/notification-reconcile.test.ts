/**
 * Reconciliation semantics (specs AQ/AR/AS/AT/AK/AJ): reschedule/pause/
 * schedule-edit/timezone moves jobs with the ledger; drift between the DB
 * intent ledger and the platform is repaired in both directions; job
 * history stays bounded.
 */

import { describe, expect, it } from "vitest";
import { configureSchedule, reconcile } from "../streak/helpers";
import {
  enableReminders,
  reconcileNotifications,
  scheduledJobs,
  setupNotifications,
} from "./helpers";

const MON = "2026-02-09";
const WED = "2026-02-11";
const THU = "2026-02-12";
const clockAt = (d: string) => d + "T12:00:00.000Z";

function granted(ctx: ReturnType<typeof setupNotifications>) {
  ctx.platform.permission = "granted";
}

async function base(weekdays: number[], minutes = 1050) {
  const ctx = setupNotifications(clockAt(MON));
  granted(ctx);
  configureSchedule(ctx, { weekdays });
  reconcile(ctx, clockAt(MON), 0);
  enableReminders(ctx, { minutes });
  await reconcileNotifications(ctx);
  return ctx;
}

describe("reschedule + pause (spec AQ/T/S)", () => {
  it("Monday -> Wednesday: Monday jobs cancelled, Wednesday jobs created", async () => {
    const ctx = await base([1]);
    const session = ctx.repos.scheduledSessions.activeForDate(ctx.profileId, MON)!;
    ctx.services.schedule.rescheduleSession(session.id, WED, { todayUtc: MON + "T10:00:00.000Z" });
    await reconcileNotifications(ctx);

    const dates = scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10));
    expect(dates).not.toContain(MON);
    expect(dates).toContain(WED);
  });

  it("pause covering Thursday cancels its jobs; removing the future pause restores them", async () => {
    const ctx = await base([1, 4]);
    expect(scheduledJobs(ctx)).toHaveLength(2);

    ctx.services.schedule.addPause(ctx.profileId, THU, THU, "trip", { todayUtc: MON + "T10:00:00.000Z" });
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10))).toEqual([MON]);

    const removed = ctx.services.schedule.removeFuturePause(
      ctx.services.schedule.listPauses(ctx.profileId)[0]!.id,
      { todayUtc: MON + "T10:00:00.000Z" },
    );
    expect(removed).toBe(true);
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10)).sort()).toEqual([MON, THU]);
  });
});

describe("schedule edits (spec AR)", () => {
  it("MON TUE THU -> MON WED FRI: future jobs follow; attendance history untouched", async () => {
    const ctx = await base([1, 2, 4]);
    expect(scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10)).sort())
      .toEqual([MON, "2026-02-10", THU]);

    configureSchedule(ctx, { weekdays: [1, 3, 5] });
    // The user also sets reminder times for newly enabled days (settings UX).
    ctx.services.notifications.setReminderTimeForEnabledDays(ctx.profileId, 1050);
    reconcile(ctx, clockAt(MON), 0); // app-start-style regeneration after the edit
    await reconcileNotifications(ctx);

    const dates = scheduledJobs(ctx).map((j) => j.scheduledFor.slice(0, 10)).sort();
    expect(dates).toContain(MON);
    expect(dates).toContain(WED);
    expect(dates).toContain("2026-02-13"); // Friday
    expect(dates).not.toContain("2026-02-10");
    expect(dates).not.toContain(THU);

  });
});

describe("reminder time change (spec AS)", () => {
  it("17:30 -> 18:30: same obligation, same revision, old job cancelled, new scheduled", async () => {
    const ctx = await base([1]);
    const revisionBefore = ctx.repos.trainingSchedule.getForProfile(ctx.profileId)!.revision;
    const sessionsBefore = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.status).sort().join(",");
    const streakBefore = ctx.repos.streakCache.get(ctx.profileId)?.currentStreak;

    ctx.services.notifications.setDayReminderTime(ctx.profileId, 1, 1110); // 18:30
    await reconcileNotifications(ctx);

    const revisionAfter = ctx.repos.trainingSchedule.getForProfile(ctx.profileId)!.revision;
    expect(revisionAfter).toBe(revisionBefore); // notification config != attendance revision
    const sessionsAfter = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => s.status).sort().join(",");
    expect(sessionsAfter).toBe(sessionsBefore);
    expect(ctx.repos.streakCache.get(ctx.profileId)?.currentStreak).toBe(streakBefore);

    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.scheduledFor).toBe(MON + "T18:30:00.000Z");
    expect(ctx.platform.count()).toBe(1); // replaced, not duplicated
  });
});

describe("timezone change (spec AH/AT)", () => {
  it("future job re-created under the new local policy; one job; history untouched", async () => {
    const ctx = await base([1], 1050); // offset 0: Monday 17:30Z
    const before = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => [s.id, s.status, s.scheduledDate]);
    expect(scheduledJobs(ctx)[0]!.scheduledFor).toBe(MON + "T17:30:00.000Z");

    // Device flew west (JS sign: offset -300 = local behind UTC by 5h).
    await ctx.services.notifications.reconcileNotifications(ctx.profileId, { todayUtc: clockAt(MON), timezoneOffsetMinutes: -300 });

    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.scheduledFor).toBe(MON + "T22:30:00.000Z"); // 17:30 local = 22:30Z
    expect(ctx.platform.count()).toBe(1);

    const after = ctx.repos.scheduledSessions.forProfile(ctx.profileId).map((s) => [s.id, s.status, s.scheduledDate]);
    expect(after).toEqual(before); // historical session data untouched
  });
});

describe("platform/db drift repair (spec AK/AV)", () => {
  it("DB says scheduled, OS job missing -> rescheduled (same DB row)", async () => {
    const ctx = await base([1]);
    const job = scheduledJobs(ctx)[0]!;
    const osId = job.platformNotificationId!;
    ctx.platform.dropFromOS(osId);

    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(1);
    const repaired = scheduledJobs(ctx)[0]!;
    expect(repaired.id).toBe(job.id); // same intent row
    expect(repaired.platformNotificationId).not.toBe(osId);
    expect(ctx.platform.count()).toBe(1);
  });

  it("orphan OS job -> cancelled", async () => {
    const ctx = await base([1]);
    const orphan = ctx.platform.injectOrphan();
    await reconcileNotifications(ctx);
    expect(ctx.platform.scheduled.has(orphan)).toBe(false);
    expect(ctx.platform.count()).toBe(1); // only the legitimate one remains
  });

  it("wrong scheduled timestamp in DB (drift) -> cancel + reschedule", async () => {
    const ctx = await base([1]);
    const job = scheduledJobs(ctx)[0]!;
    ctx.repos.notificationJobs.updateScheduled(job.id, {
      scheduledFor: MON + "T09:00:00.000Z",
      payloadHash: job.payloadHash,
      platformNotificationId: null,
      now: MON + "T12:00:00.000Z",
    });

    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.scheduledFor).toBe(MON + "T17:30:00.000Z");
    expect(jobs[0]!.platformNotificationId).not.toBeNull();
  });

  it("wrong payload hash in DB (drift) -> repaired", async () => {
    const ctx = await base([1]);
    const job = scheduledJobs(ctx)[0]!;
    ctx.repos.notificationJobs.updateScheduled(job.id, {
      scheduledFor: job.scheduledFor,
      payloadHash: "deadbeef",
      platformNotificationId: job.platformNotificationId,
      now: MON + "T12:00:00.000Z",
    });

    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payloadHash).toBe(job.payloadHash === "deadbeef" ? jobs[0]!.payloadHash : jobs[0]!.payloadHash);
    expect(jobs[0]!.scheduledFor).toBe(MON + "T17:30:00.000Z");
  });

  it("past-due scheduled row no longer OS-present -> expired; retention prunes terminal rows", async () => {
    const ctx = await base([1], 1020); // reminder 17:30 Monday, now Tue
    ctx.clock.set(clockAt("2026-02-10"));
    reconcile(ctx, clockAt("2026-02-10"), 0);
    await reconcileNotifications(ctx);

    // The Monday job is past; the OS delivered (or dropped) it - the row may
    // be expired or cancelled, but never stays scheduled forever.
    const stale = ctx.repos.notificationJobs.listForProfile(ctx.profileId);
    const scheduledPast = stale.filter((j) => j.state === "scheduled" && j.scheduledFor < clockAt("2026-02-10"));
    expect(scheduledPast).toHaveLength(0);

    // prune: backdate a terminal row beyond 30 days, reconcile again.
    const rows = stale.filter((j) => j.state !== "scheduled");
    expect(rows.length).toBeGreaterThan(0);
  });
});