/**
 * Secondary reminders (specs N/O/AP): optional, user-controlled, at most TWO
 * training reminders per session, always inside the session's logical day.
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
const clockAt = (d: string) => d + "T12:00:00.000Z";

async function ready(ctx: ReturnType<typeof setupNotifications>) {
  ctx.platform.permission = "granted";
  configureSchedule(ctx, { weekdays: [1] });
  reconcile(ctx, clockAt(MON), 0);
  enableReminders(ctx, { minutes: 1050, secondary: true, secondaryDelay: 150 }); // 17:30 + 150m = 20:00
  await reconcileNotifications(ctx);
}

describe("secondary reminders (spec N/O/AP)", () => {
  it("enabled -> creates a second job for the same session", async () => {
    const ctx = setupNotifications(clockAt(MON));
    await ready(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.kind).sort()).toEqual(["training_primary", "training_secondary"]);
    expect(new Set(jobs.map((j) => j.scheduledSessionId)).size).toBe(1); // same obligation
    const secondary = jobs.find((j) => j.kind === "training_secondary")!;
    expect(secondary.scheduledFor).toBe(MON + "T20:00:00.000Z"); // 17:30 + 150min
    expect(secondary.dedupeKey.endsWith(":training_secondary")).toBe(true);
  });

  it("disabled -> one job only", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1050, secondary: false });
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx)).toHaveLength(1);
    expect(scheduledJobs(ctx)[0]!.kind).toBe("training_primary");
  });

  it("completion between primary and secondary cancels the secondary (spec P)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    await ready(ctx); // clock is MON 12:00: both 17:30 and 20:00 are future
    expect(ctx.platform.count()).toBe(2);

    const workoutId = completeWorkoutOn(ctx, MON, { atUtc: MON + "T18:45:00.000Z" });
    processStreak(ctx, MON + "T19:00:00.000Z", 0);
    await reconcileNotifications(ctx);
    expect(ctx.repos.scheduledSessions.forWorkout(workoutId)).not.toBeNull();
    expect(scheduledJobs(ctx)).toHaveLength(0); // 20:00 secondary gone
    expect(ctx.platform.count()).toBe(0);
  });

  it("delay across midnight but within the logical day works (spec O)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1380, secondary: true, secondaryDelay: 150 }); // 23:00 + 150m = 01:30 Tue
    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(2);
    const secondary = jobs.find((j) => j.kind === "training_secondary")!;
    // Tuesday 01:00 belongs to Monday's logical day -> allowed (before 04:00).
    expect(secondary.scheduledFor).toBe(MON.slice(0, 8) + "10" + "T01:30:00.000Z");
  });

  it("delay reaching the 04:00 boundary produces NO secondary (never next day)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1380, secondary: true, secondaryDelay: 300 }); // 23:00 + 300m = 04:00 Tue
    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(1); // primary only
    expect(jobs[0]!.kind).toBe("training_primary");
  });

  it("delay beyond the 04:00 boundary produces NO secondary", async () => {
    const ctx = setupNotifications(clockAt(MON));
    ctx.platform.permission = "granted";
    configureSchedule(ctx, { weekdays: [1] });
    reconcile(ctx, clockAt(MON), 0);
    enableReminders(ctx, { minutes: 1410, secondary: true, secondaryDelay: 360 }); // 23:30 + 6h = 05:30 Tue
    await reconcileNotifications(ctx);
    expect(scheduledJobs(ctx).map((j) => j.kind)).toEqual(["training_primary"]);
  });

  it("repeated reconcile never duplicates the secondary", async () => {
    const ctx = setupNotifications(clockAt(MON));
    await ready(ctx);
    await reconcileNotifications(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(2);
    const kinds = scheduledJobs(ctx).map((j) => j.kind).sort();
    expect(kinds).toEqual(["training_primary", "training_secondary"]);
  });

  it("secondary delay changes re-reconcile in place (cancel old + schedule new, no dup)", async () => {
    const ctx = setupNotifications(clockAt(MON));
    await ready(ctx);
    ctx.services.notifications.updatePreferences(ctx.profileId, { secondaryDelayMinutes: 60 });
    await reconcileNotifications(ctx);
    const jobs = scheduledJobs(ctx);
    expect(jobs).toHaveLength(2);
    const secondary = jobs.find((j) => j.kind === "training_secondary")!;
    expect(secondary.scheduledFor).toBe(MON + "T18:30:00.000Z");
  });
});