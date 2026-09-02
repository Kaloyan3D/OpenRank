/**
 * Rest-timer notifications (specs Z/AA/AB/AC/AU): optional delivery attached
 * to the persisted restEndsAt instant. Timer correctness NEVER depends on
 * permission (spec AB); restarts never duplicate the notification (spec AC).
 */

import { describe, expect, it } from "vitest";
import { createServices } from "../services";
import { openDatabase } from "../index";
import { NodeSqliteDriver } from "../node-driver";
import { openTestDb } from "../testing/helpers";
import { cleanupFileDb } from "./helpers";
import { reconcileNotifications, setupNotifications, setupNotificationsFile } from "./helpers";

/** Windows can briefly hold the WAL file after close - retry the cleanup. */
async function cleanupWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      cleanupFileDb(dir);
      return;
    } catch {
      if (attempt >= 5) return; // temp dir: harmless if it lingers
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

const NOW = "2026-02-12T12:00:00.000Z";

async function ready(opts: { rest?: boolean; permission?: "granted" | "denied" } = {}) {
  const ctx = setupNotifications(NOW);
  ctx.platform.permission = opts.permission ?? "granted";
  ctx.services.notifications.updatePreferences(ctx.profileId, { restTimerNotificationsEnabled: opts.rest ?? true });
  return ctx;
}

function startRest(ctx: ReturnType<typeof setupNotifications>, seconds = 90) {
  const workout = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: NOW });
  ctx.services.restTimer.start(ctx.profileId, workout.id, seconds);
  return workout.id;
}

describe("rest timer notifications (spec AU)", () => {
  it("start timer -> exactly one OS notification at restEndsAt", async () => {
    const ctx = await ready();
    const workoutId = startRest(ctx, 90);
    await reconcileNotifications(ctx);
    const jobs = ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("rest_timer");
    expect(jobs[0]!.dedupeKey).toBe("rest:" + workoutId);
    expect(jobs[0]!.scheduledFor).toBe(new Date(Date.parse(NOW) + 90_000).toISOString());
    const os = [...ctx.platform.scheduled.values()];
    expect(os).toHaveLength(1);
    expect(os[0]!.title).toBe("Rest complete");
    expect(os[0]!.body).toBe("Time for your next set.");
  });

  it("+15 -> old cancelled, new scheduled (still one)", async () => {
    const ctx = await ready();
    startRest(ctx, 90);
    await reconcileNotifications(ctx);
    const before = [...ctx.platform.scheduled.keys()];

    ctx.services.restTimer.addSeconds(ctx.profileId, 15);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);
    const after = [...ctx.platform.scheduled.keys()];
    expect(after[0]).not.toBe(before[0]); // replaced at the OS level
    const job = ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)[0]!;
    expect(job.scheduledFor).toBe(new Date(Date.parse(NOW) + 105_000).toISOString());
  });

  it("-15 -> rescheduled", async () => {
    const ctx = await ready();
    startRest(ctx, 90);
    await reconcileNotifications(ctx);
    ctx.services.restTimer.addSeconds(ctx.profileId, -30);
    await reconcileNotifications(ctx);
    const job = ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)[0]!;
    expect(job.scheduledFor).toBe(new Date(Date.parse(NOW) + 60_000).toISOString());
    expect(ctx.platform.count()).toBe(1);
  });

  it("skip -> notification cancelled", async () => {
    const ctx = await ready();
    startRest(ctx);
    await reconcileNotifications(ctx);
    ctx.services.restTimer.skip(ctx.profileId);
    await reconcileNotifications(ctx);
    expect(ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("finish workout -> notification cancelled", async () => {
    const ctx = await ready();
    const workoutId = startRest(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(1);

    ctx.services.workout.finishWorkout(workoutId, { incompleteSetPolicy: "remove", finishedAtUtc: NOW });
    await reconcileNotifications(ctx);
    expect(ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)).toHaveLength(0);
    expect(ctx.platform.count()).toBe(0);
  });

  it("permission denied -> timer fully functional, zero notifications (spec AB)", async () => {
    const ctx = await ready({ permission: "denied" });
    const workoutId = startRest(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.platform.count()).toBe(0);
    expect(ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)).toHaveLength(0);

    const rest = ctx.services.restTimer.getActive(ctx.profileId)!;
    expect(rest.workoutId).toBe(workoutId);
    expect(rest.remainingSeconds).toBeGreaterThan(0); // timer works
  });

  it("rest notifications disabled -> timer works, zero notifications", async () => {
    const ctx = await ready({ rest: false });
    startRest(ctx);
    await reconcileNotifications(ctx);
    expect(ctx.services.restTimer.getActive(ctx.profileId)).not.toBeNull();
    expect(ctx.platform.count()).toBe(0);
  });

  it("process restart (app killed) -> reconcile repairs without duplicates (spec AC)", async () => {
    const ctx = setupNotificationsFile(NOW);
    let driver2: NodeSqliteDriver | null = null;
    try {
      ctx.platform.permission = "granted";
      ctx.services.notifications.updatePreferences(ctx.profileId, { restTimerNotificationsEnabled: true });
      const workout = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: NOW });
      ctx.services.restTimer.start(ctx.profileId, workout.id, 120);
      await reconcileNotifications(ctx);
      const osIdBefore = [...ctx.platform.scheduled.keys()][0]!;
      ctx.driver.close();

      // Reopen: the OS scheduler store survives process death; the DB restarts.
      driver2 = new NodeSqliteDriver(ctx.path);
      const repos2 = openDatabase(driver2, {});
      const platform2 = ctx.platform; // the OS scheduler store survives process death
      const services2 = createServices(driver2, repos2, { now: () => NOW, notificationPlatform: platform2 });
      const profileId = ctx.profileId;
      await services2.notifications.reconcileNotifications(profileId);
      const jobs = repos2.notificationJobs.scheduledForProfile(profileId);
      expect(jobs).toHaveLength(1);
      expect(platform2.count()).toBe(1);
      expect([...platform2.scheduled.keys()][0]).toBe(osIdBefore);
    } finally {
      driver2?.close();
      await cleanupWithRetry(ctx.dir);
    }
  });

  it("expired rest (endsAt passed) -> no new notification, job expires", async () => {
    const ctx = await ready();
    startRest(ctx, 30);
    ctx.clock.set(new Date(Date.parse(NOW) + 60_000).toISOString());
    await reconcileNotifications(ctx);
    expect(ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId)).toHaveLength(0);
  });
});

describe("rest timer without notification service involvement", () => {
  it("default (Null) platform: timer + workout flows unchanged", () => {
    const db = openTestDb(false);
    const services = createServices(db.driver, db.repos);
    const profile = db.repos.profile.ensureDefault();
    const workout = services.workout.startEmptyWorkout(profile.id);
    services.restTimer.start(profile.id, workout.id, 60);
    expect(services.restTimer.getActive(profile.id)!.remainingSeconds).toBeGreaterThan(0);
    services.restTimer.skip(profile.id);
    expect(services.restTimer.getActive(profile.id)).toBeNull();
  });
});