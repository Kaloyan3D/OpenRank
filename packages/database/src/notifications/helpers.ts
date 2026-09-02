/** Phase 7 test helpers: fake platform + mutable clock + scenario setup. */

import type { NotificationPermissionStatus, ScheduledSession } from "@openrank/domain";
import { deterministicRepos, openTestFileDb, cleanupFileDb } from "../testing/helpers";
import { createServices } from "../services";
import type { NotificationPlatform, PlatformNotificationRequest } from "../services/notifications/platform";
import { fixedClock, type Ctx } from "../streak/helpers";

export { openTestFileDb, cleanupFileDb, fixedClock };
export type { Ctx };

export class FakeNotificationPlatform implements NotificationPlatform {
  permission: NotificationPermissionStatus = "undetermined";
  requestPermissionResult: NotificationPermissionStatus = "granted";
  readonly scheduled = new Map<string, PlatformNotificationRequest>();
  private counter = 0;

  async getPermissionStatus(): Promise<NotificationPermissionStatus> {
    return this.permission;
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    this.permission = this.requestPermissionResult;
    return this.permission;
  }

  async schedule(request: PlatformNotificationRequest): Promise<string> {
    const id = "os:" + String(++this.counter);
    this.scheduled.set(id, { ...request });
    return id;
  }

  async cancel(platformNotificationId: string): Promise<void> {
    this.scheduled.delete(platformNotificationId);
  }

  async getScheduled(): Promise<string[]> {
    return [...this.scheduled.keys()];
  }

  dropFromOS(platformNotificationId: string): void {
    this.scheduled.delete(platformNotificationId);
  }

  injectOrphan(): string {
    const id = "os:orphan:" + String(++this.counter);
    this.scheduled.set(id, {
      dedupeKey: "orphan:" + String(this.counter),
      title: "x",
      body: "x",
      scheduledFor: "2030-01-01T00:00:00.000Z",
      payload: { type: "training_reminder", profileId: "p", scheduledSessionId: "s" },
      channelId: "training",
    });
    return id;
  }

  count(): number {
    return this.scheduled.size;
  }

  byDedupeKey(key: string): PlatformNotificationRequest | null {
    for (const r of this.scheduled.values()) if (r.dedupeKey === key) return r;
    return null;
  }

  summaries(): string[] {
    return [...this.scheduled.values()].map((r) => r.title + "|" + r.body + "|" + r.scheduledFor).sort();
  }
}

export interface MutableClock {
  at: string;
  clock: () => string;
  set(iso: string): void;
}

export function mutableClock(startAt?: string): MutableClock {
  const state: { at: string } = { at: startAt ?? "2026-02-12T12:00:00.000Z" };
  return { at: state.at, clock: () => state.at, set(iso: string) { state.at = iso; } };
}

export interface NotificationCtx extends Ctx {
  platform: FakeNotificationPlatform;
  clock: MutableClock;
}

export function setupNotifications(nowAt?: string): NotificationCtx {
  const db = deterministicRepos();
  const platform = new FakeNotificationPlatform();
  const clock = mutableClock(nowAt);
  const services = createServices(db.driver, db.repos, { now: clock.clock, notificationPlatform: platform });
  const profile = db.repos.profile.ensureDefault();
  return { driver: db.driver, repos: db.repos, services, profileId: profile.id, platform, clock };
}

export interface NotificationFileCtx extends NotificationCtx {
  path: string;
  dir: string;
}

export function setupNotificationsFile(nowAt?: string): NotificationFileCtx {
  const db = openTestFileDb();
  const platform = new FakeNotificationPlatform();
  const clock = mutableClock(nowAt);
  const services = createServices(db.driver, db.repos, { now: clock.clock, notificationPlatform: platform });
  const profile = db.repos.profile.ensureDefault();
  return {
    driver: db.driver, repos: db.repos, services, profileId: profile.id, platform, clock,
    path: db.path, dir: db.dir,
  };
}

export interface EnableReminderOptions {
  style?: "gentle" | "normal" | "competitive";
  minutes?: number;
  secondary?: boolean;
  secondaryDelay?: number;
  rest?: boolean;
}

/** Enable training reminders + optional secondary + set all enabled days' time. */
export function enableReminders(ctx: NotificationCtx, opts: EnableReminderOptions = {}): void {
  ctx.services.notifications.updatePreferences(ctx.profileId, {
    trainingRemindersEnabled: true,
    reminderStyle: opts.style ?? "normal",
    secondaryReminderEnabled: opts.secondary ?? false,
    secondaryDelayMinutes: opts.secondaryDelay ?? 150,
    restTimerNotificationsEnabled: opts.rest ?? false,
  });
  ctx.services.notifications.setReminderTimeForEnabledDays(ctx.profileId, opts.minutes ?? 1050); // 17:30
}

export async function reconcileNotifications(ctx: NotificationCtx) {
  return ctx.services.notifications.reconcileNotifications(ctx.profileId, { todayUtc: ctx.clock.at, timezoneOffsetMinutes: 0 });
}

export function scheduledJobs(ctx: NotificationCtx) {
  return ctx.repos.notificationJobs.scheduledForProfile(ctx.profileId);
}

export function sessionOn(ctx: NotificationCtx, date: string): ScheduledSession | null {
  return ctx.repos.scheduledSessions.activeForDate(ctx.profileId, date);
}