/**
 * NotificationService (Phase 7, specs A-U).
 *
 * Entirely LOCAL: SQLite -> NotificationService -> NotificationPlatform ->
 * OS scheduler. Reminders derive from the materialized scheduled_sessions
 * ledger (one-off OS notifications), NEVER from weekly recurring patterns,
 * so reschedules, pauses, completion, disable and timezone shifts all
 * reconcile by construction (spec A).
 *
 * Reconciliation (spec J/K) is idempotent, restart-safe and retry-safe:
 * desired set (from ledger + preferences) is compared against the DB job
 * ledger AND the platform's scheduled notifications; drift is repaired in
 * both directions (spec AK). The DB represents scheduling INTENT - never
 * proof of on-screen delivery.
 *
 * Streak correctness is untouched: nothing here reads or writes
 * scheduled_sessions status. A completed session's future jobs are
 * cancelled because it left the pending set, not the other way around.
 */

import type {
  NotificationJob,
  NotificationJobKind,
  NotificationPreferences,
  NotificationPreferencesRepository,
  NotificationJobRepository,
  RestTimerRepository,
  RoutineRepository,
  ScheduleWeekday,
  ScheduledSessionRepository,
  TrainingScheduleRepository,
  NotificationPayload,
} from "@openrank/domain";
import type { DatabaseDriver } from "../../driver";
import { computeLogicalTrainingDate } from "../logical-date";
import { addDays, isoWeekdayOf } from "../iso-week";
import { logicalDayEndInstant, reminderInstant } from "./time";
import { primaryReminderContent, restTimerContent, secondaryReminderContent } from "./content";
import { restDedupeKey, stableHash, trainingDedupeKey } from "./payload";
import type { NotificationChannelId, NotificationPlatform, PlatformNotificationRequest } from "./platform";

export interface NotificationReconcileReport {
  scheduled: number;
  cancelled: number;
  expired: number;
  repaired: number;
  permission: "undetermined" | "granted" | "denied";
}

export interface ReconcileOptions {
  todayUtc?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
}

export interface NotificationServiceDeps {
  prefs: NotificationPreferencesRepository;
  jobs: NotificationJobRepository;
  sessions: ScheduledSessionRepository;
  schedule: TrainingScheduleRepository;
  restTimer: RestTimerRepository;
  /** Routine-name context for reminder copy; absence falls back to generic copy. */
  routines: RoutineRepository | null;
}

export interface NotificationServiceOptions {
  now?: (() => string) | undefined;
  newId?: (() => string) | undefined;
}

interface DesiredJob {
  kind: NotificationJobKind;
  dedupeKey: string;
  scheduledSessionId: string | null;
  scheduledFor: string;
  title: string;
  body: string;
  payload: NotificationPayload;
  channelId: NotificationChannelId;
}

/**
 * Reminders materialize for a bounded rolling window (7 days). The
 * reconciler re-runs constantly (app start, every schedule mutation), so a
 * short horizon keeps the OS scheduler load tiny while the window always
 * covers everything the user can see. Documented in docs/NOTIFICATIONS_SPEC.md.
 */
export const NOTIFICATION_HORIZON_DAYS = 7;

function jobPayloadHash(d: DesiredJob): string {
  return stableHash([d.kind, d.dedupeKey, d.scheduledFor, d.title, d.body, d.payload.type, d.payload.profileId, d.payload.scheduledSessionId ?? "", d.payload.workoutId ?? ""].join("|"));
}

export class NotificationService {
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(
    private readonly driver: DatabaseDriver,
    private readonly deps: NotificationServiceDeps,
    private readonly platform: NotificationPlatform,
    options: NotificationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  // -------------------------------------------------------- preferences --

  ensurePreferences(profileId: string): NotificationPreferences {
    return this.deps.prefs.ensureDefault(profileId);
  }

  getPreferences(profileId: string): NotificationPreferences {
    return this.deps.prefs.ensureDefault(profileId);
  }

  /** Persist preference changes. Callers trigger reconcile afterwards (spec K). */
  updatePreferences(
    profileId: string,
    patch: Partial<Pick<NotificationPreferences, "trainingRemindersEnabled" | "secondaryReminderEnabled" | "secondaryDelayMinutes" | "reminderStyle" | "restTimerNotificationsEnabled" | "permissionPromptSeen">>,
  ): NotificationPreferences {
    return this.deps.prefs.update(profileId, patch);
  }

  /**
   * Per-day reminder time (spec E): notification configuration ONLY - never
   * touches the attendance schedule, its revision or history. Accepts
   * minutes 0..1439 (or null to clear); the <04:00 logical-day rule is
   * applied at scheduling time, not stored differently.
   */
  setDayReminderTime(profileId: string, weekday: ScheduleWeekday, minutes: number | null): void {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439)) {
      throw new Error("reminder minutes out of range: " + String(minutes));
    }
    const schedule = this.deps.schedule.ensureDefault(profileId);
    this.driver.transaction(() => {
      this.deps.schedule.setDayReminder(schedule.id, weekday, minutes);
    });
  }

  /** Convenience for onboarding/settings: set one time for ALL enabled days. */
  setReminderTimeForEnabledDays(profileId: string, minutes: number): void {
    const schedule = this.deps.schedule.ensureDefault(profileId);
    this.driver.transaction(() => {
      for (const day of this.deps.schedule.getDays(schedule.id)) {
        if (day.enabled) this.deps.schedule.setDayReminder(schedule.id, day.weekday, minutes);
      }
    });
  }

  // --------------------------------------------------------- permission --

  /** Pre-permission flow (spec V): the UI explains FIRST, then calls this. */
  async requestPermission(profileId: string): Promise<"undetermined" | "granted" | "denied"> {
    const status = await this.platform.requestPermission();
    this.deps.prefs.update(profileId, { permissionStatus: status, permissionPromptSeen: true });
    return status;
  }

  /** Re-read the OS state (e.g. after returning from system settings). */
  async refreshPermissionStatus(profileId: string): Promise<"undetermined" | "granted" | "denied"> {
    const status = await this.platform.getPermissionStatus();
    this.deps.prefs.update(profileId, { permissionStatus: status });
    return status;
  }

  // -------------------------------------------------------- reconciler --

  /**
   * Reconcile desired notifications with the DB ledger and the platform.
   * Idempotent: repeated calls converge to the same OS state (spec H/AO).
   */
  async reconcileNotifications(profileId: string, options: ReconcileOptions = {}): Promise<NotificationReconcileReport> {
    const report: NotificationReconcileReport = { scheduled: 0, cancelled: 0, expired: 0, repaired: 0, permission: "undetermined" };
    const nowTs = this.now();
    const offset = options.timezoneOffsetMinutes ?? 0;
    const prefs = this.deps.prefs.ensureDefault(profileId);

    const perm = await this.platform.getPermissionStatus();
    report.permission = perm;
    if (prefs.permissionStatus !== perm) this.deps.prefs.update(profileId, { permissionStatus: perm });

    const claimedIds = new Set(this.driver.all("SELECT platform_notification_id FROM notification_jobs WHERE state = 'scheduled' AND platform_notification_id IS NOT NULL", []).map((r) => String(r.platform_notification_id)));
    const osIds = new Set(await this.platform.getScheduled());

    if (perm !== "granted") {
      // No OS schedules without permission (spec AN). Cancel everything of
      // ours that is still OS-scheduled, for every profile (device-global).
      return this.cancelEverything(report, nowTs, osIds);
    }

    const desired = this.desiredJobs(profileId, prefs, nowTs, offset);

    // -- merge with existing scheduled jobs (spec H/AK) --
    const existing = this.deps.jobs.scheduledForProfile(profileId);
    const existingByKey = new Map(existing.map((j) => [j.dedupeKey, j]));

    for (const d of desired) {
      const hash = jobPayloadHash(d);
      const current = existingByKey.get(d.dedupeKey);
      if (!current) {
        const job = this.newJob(profileId, d, hash, nowTs);
        if (this.deps.jobs.insert(job)) {
          const pid = await this.platform.schedule(this.toRequest(d));
          this.deps.jobs.setPlatformId(job.id, pid, nowTs);
          claimedIds.add(pid);
          osIds.add(pid);
          report.scheduled += 1;
        }
        continue;
      }
      existingByKey.delete(d.dedupeKey);
      if (current.payloadHash === hash && current.scheduledFor === d.scheduledFor) {
        if (current.platformNotificationId && osIds.has(current.platformNotificationId)) continue; // DB + OS correct -> no-op
        // Drift: DB intent exists, OS job missing -> reschedule (spec AK).
        const pid = await this.platform.schedule(this.toRequest(d));
        this.deps.jobs.updateScheduled(current.id, { scheduledFor: d.scheduledFor, payloadHash: hash, platformNotificationId: pid, now: nowTs });
        claimedIds.add(pid);
        osIds.add(pid);
        report.repaired += 1;
        continue;
      }
      // Intent changed (time/style/payload) -> cancel old, schedule new.
      if (current.platformNotificationId) {
        await this.platform.cancel(current.platformNotificationId);
        osIds.delete(current.platformNotificationId);
      }
      const pid = await this.platform.schedule(this.toRequest(d));
      this.deps.jobs.updateScheduled(current.id, { scheduledFor: d.scheduledFor, payloadHash: hash, platformNotificationId: pid, now: nowTs });
      claimedIds.add(pid);
      osIds.add(pid);
      report.scheduled += 1;
      report.cancelled += 1;
    }

    // -- leftover scheduled rows: no longer desired -> cancel (DB + OS) --
    const leftoverIds: string[] = [];
    for (const leftover of existingByKey.values()) {
      if (leftover.platformNotificationId) {
        await this.platform.cancel(leftover.platformNotificationId);
        osIds.delete(leftover.platformNotificationId);
      }
      leftoverIds.push(leftover.id);
    }
    if (leftoverIds.length > 0) this.deps.jobs.markCancelled(leftoverIds, nowTs);
    report.cancelled += leftoverIds.length;

    // -- orphaned OS notifications (no scheduled row anywhere) -> cancel --
    for (const orphanId of osIds) {
      if (claimedIds.has(orphanId)) continue;
      await this.platform.cancel(orphanId);
      report.cancelled += 1;
    }

    // -- expiry (spec AJ): past-due scheduled rows no longer OS-present --
    const expiredIds = this.deps.jobs
      .scheduledForProfile(profileId)
      .filter((j) => j.scheduledFor < nowTs && (j.platformNotificationId == null || !osIds.has(j.platformNotificationId)))
      .map((j) => j.id);
    if (expiredIds.length > 0) this.deps.jobs.markExpired(expiredIds, nowTs);
    report.expired += expiredIds.length;

    // Bounded retention: drop terminal rows older than 30 days.
    this.deps.jobs.pruneTerminalBefore(new Date(Date.parse(nowTs) - 30 * 86_400_000).toISOString());
    return report;
  }

  // ----------------------------------------------------------- desired --

  /**
   * The desired future notification set (pure given the ledger).
   * Rest days / resolved sessions produce ZERO training reminders (spec AM).
   */
  desiredJobs(profileId: string, prefs: NotificationPreferences, nowTs: string, offset: number): DesiredJob[] {
    const desired: DesiredJob[] = [];
    const schedule = this.deps.schedule.getForProfile(profileId);

    if (prefs.trainingRemindersEnabled && schedule && schedule.enabled) {
      const days = this.deps.schedule.getDays(schedule.id);
      const dayByWeekday = new Map(days.map((d) => [d.weekday, d]));
      const todayLogical = computeLogicalTrainingDate(nowTs, offset);
      const horizonEnd = addDays(todayLogical, NOTIFICATION_HORIZON_DAYS - 1);
      for (const session of this.deps.sessions.pendingFrom(profileId, todayLogical)) {
        if (session.scheduledDate > horizonEnd) continue;
        // Reminder time is a per-weekday configuration; a RESCHEDULED
        // obligation keeps the time of its ORIGINAL training day (the user
        // configured "Monday 17:30" - the moved session still reminds at
        // 17:30, wherever it landed).
        const minutes =
          dayByWeekday.get(isoWeekdayOf(session.scheduledDate))?.reminderMinutesAfterMidnight ??
          dayByWeekday.get(isoWeekdayOf(session.originalDate))?.reminderMinutesAfterMidnight ??
          null;
        if (minutes == null) continue; // no reminder time configured for that obligation
        const boundary = schedule.dayBoundaryMinutes;
        const primaryAt = reminderInstant(session.scheduledDate, minutes, offset, boundary);
        const content = primaryReminderContent(prefs.reminderStyle, this.routineNameFor(profileId, session));
        if (primaryAt > nowTs) {
          desired.push({
            kind: "training_primary",
            dedupeKey: trainingDedupeKey(session.id, "training_primary"),
            scheduledSessionId: session.id,
            scheduledFor: primaryAt,
            title: content.title,
            body: content.body,
            payload: { type: "training_reminder", profileId, scheduledSessionId: session.id },
            channelId: "training",
          });
        }
        if (prefs.secondaryReminderEnabled) {
          const secondaryAt = new Date(Date.parse(primaryAt) + prefs.secondaryDelayMinutes * 60_000).toISOString();
          const dayEnd = logicalDayEndInstant(session.scheduledDate, offset, boundary);
          // Secondary must stay INSIDE the logical training day (spec O) and
          // in the future. Never pushed into the next training day.
          if (secondaryAt > nowTs && secondaryAt < dayEnd) {
            const secContent = secondaryReminderContent(prefs.reminderStyle);
            desired.push({
              kind: "training_secondary",
              dedupeKey: trainingDedupeKey(session.id, "training_secondary"),
              scheduledSessionId: session.id,
              scheduledFor: secondaryAt,
              title: secContent.title,
              body: secContent.body,
              payload: { type: "training_reminder", profileId, scheduledSessionId: session.id },
              channelId: "training",
            });
          }
        }
      }
    }

    if (prefs.restTimerNotificationsEnabled) {
      const rest = this.deps.restTimer.get(profileId, nowTs);
      if (rest && rest.endsAt > nowTs) {
        const content = restTimerContent();
        desired.push({
          kind: "rest_timer",
          dedupeKey: restDedupeKey(rest.workoutId),
          scheduledSessionId: null,
          scheduledFor: rest.endsAt,
          title: content.title,
          body: content.body,
          payload: { type: "rest_timer", profileId, workoutId: rest.workoutId },
          channelId: "rest",
        });
      }
    }

    return desired;
  }

  private routineNameFor(_profileId: string, session: { routineId: string | null }): string | null {
    if (!session.routineId || !this.deps.routines) return null;
    return this.deps.routines.getById(session.routineId)?.routine.name ?? null;
  }

  private newJob(profileId: string, d: DesiredJob, hash: string, nowTs: string): NotificationJob {
    return {
      id: this.newId(),
      profileId,
      kind: d.kind,
      scheduledSessionId: d.scheduledSessionId,
      dedupeKey: d.dedupeKey,
      scheduledFor: d.scheduledFor,
      platformNotificationId: null,
      state: "scheduled",
      payloadHash: hash,
      createdAt: nowTs,
      updatedAt: nowTs,
      cancelledAt: null,
    };
  }

  private toRequest(d: DesiredJob): PlatformNotificationRequest {
    return { dedupeKey: d.dedupeKey, title: d.title, body: d.body, scheduledFor: d.scheduledFor, payload: d.payload, channelId: d.channelId };
  }

  private async cancelEverything(report: NotificationReconcileReport, nowTs: string, osIds: Set<string>): Promise<NotificationReconcileReport> {
    const allScheduled = this.driver.all("SELECT id, platform_notification_id FROM notification_jobs WHERE state = 'scheduled'", []);
    const ids = allScheduled.map((r) => String(r.id));
    for (const row of allScheduled) {
      const pid = row.platform_notification_id == null ? null : String(row.platform_notification_id);
      if (pid) {
        await this.platform.cancel(pid);
        osIds.delete(pid);
      }
    }
    if (ids.length > 0) this.deps.jobs.markCancelled(ids, nowTs);
    report.cancelled += ids.length;
    for (const orphanId of osIds) {
      await this.platform.cancel(orphanId);
      report.cancelled += 1;
    }
    return report;
  }
}