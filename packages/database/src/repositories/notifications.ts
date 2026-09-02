/**
 * Notification repositories (Phase 7).
 *
 * notification_preferences: per-profile local notification configuration with
 * conservative defaults (everything off until opt-in).
 *
 * notification_jobs: the scheduling INTENT ledger. The OS scheduler owns
 * actual delivery; these rows drive idempotent reconciliation (spec H/J).
 * Stable dedupe identity ("<sessionId>:<kind>" / "rest:<workoutId>") plus the
 * partial UNIQUE index on scheduled rows makes repeated scheduling a no-op.
 */

import type { NotificationJob, NotificationPreferences, NotificationJobKind } from "@openrank/domain";
import type { NotificationJobRepository, NotificationPreferencesRepository } from "@openrank/domain";
import type { DatabaseDriver, SqlRow } from "../driver";

const now = (): string => new Date().toISOString();

function mapPrefs(row: SqlRow): NotificationPreferences {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    trainingRemindersEnabled: row.training_reminders_enabled === 1,
    secondaryReminderEnabled: row.secondary_reminder_enabled === 1,
    secondaryDelayMinutes: Number(row.secondary_delay_minutes),
    reminderStyle: String(row.reminder_style) as NotificationPreferences["reminderStyle"],
    restTimerNotificationsEnabled: row.rest_timer_notifications_enabled === 1,
    permissionStatus: String(row.permission_status) as NotificationPreferences["permissionStatus"],
    permissionPromptSeen: row.permission_prompt_seen === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapJob(row: SqlRow): NotificationJob {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    kind: String(row.kind) as NotificationJobKind,
    scheduledSessionId: row.scheduled_session_id == null ? null : String(row.scheduled_session_id),
    dedupeKey: String(row.dedupe_key),
    scheduledFor: String(row.scheduled_for),
    platformNotificationId: row.platform_notification_id == null ? null : String(row.platform_notification_id),
    state: String(row.state) as NotificationJob["state"],
    payloadHash: String(row.payload_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
  };
}

export class SqliteNotificationPreferencesRepository implements NotificationPreferencesRepository {
  constructor(private readonly driver: DatabaseDriver, private readonly newId: () => string) {}

  getForProfile(profileId: string): NotificationPreferences | null {
    const row = this.driver.get("SELECT * FROM notification_preferences WHERE profile_id = ?", [profileId]);
    return row ? mapPrefs(row) : null;
  }

  ensureDefault(profileId: string): NotificationPreferences {
    const existing = this.getForProfile(profileId);
    if (existing) return existing;
    const ts = now();
    this.driver.run(
      "INSERT INTO notification_preferences (id, profile_id, training_reminders_enabled, secondary_reminder_enabled, secondary_delay_minutes, reminder_style, rest_timer_notifications_enabled, permission_status, permission_prompt_seen, created_at, updated_at)" +
        " VALUES (?, ?, 0, 0, 150, 'normal', 0, 'undetermined', 0, ?, ?)",
      [this.newId(), profileId, ts, ts],
    );
    return this.getForProfile(profileId)!;
  }

  update(
    profileId: string,
    patch: Partial<Pick<NotificationPreferences, "trainingRemindersEnabled" | "secondaryReminderEnabled" | "secondaryDelayMinutes" | "reminderStyle" | "restTimerNotificationsEnabled" | "permissionStatus" | "permissionPromptSeen">>,
  ): NotificationPreferences {
    this.ensureDefault(profileId);
    const sets: string[] = [];
    const args: (string | number)[] = [];
    if (patch.trainingRemindersEnabled !== undefined) { sets.push("training_reminders_enabled = ?"); args.push(patch.trainingRemindersEnabled ? 1 : 0); }
    if (patch.secondaryReminderEnabled !== undefined) { sets.push("secondary_reminder_enabled = ?"); args.push(patch.secondaryReminderEnabled ? 1 : 0); }
    if (patch.secondaryDelayMinutes !== undefined) { sets.push("secondary_delay_minutes = ?"); args.push(patch.secondaryDelayMinutes); }
    if (patch.reminderStyle !== undefined) { sets.push("reminder_style = ?"); args.push(patch.reminderStyle); }
    if (patch.restTimerNotificationsEnabled !== undefined) { sets.push("rest_timer_notifications_enabled = ?"); args.push(patch.restTimerNotificationsEnabled ? 1 : 0); }
    if (patch.permissionStatus !== undefined) { sets.push("permission_status = ?"); args.push(patch.permissionStatus); }
    if (patch.permissionPromptSeen !== undefined) { sets.push("permission_prompt_seen = ?"); args.push(patch.permissionPromptSeen ? 1 : 0); }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      args.push(now());
      args.push(profileId);
      this.driver.run("UPDATE notification_preferences SET " + sets.join(", ") + " WHERE profile_id = ?", args);
    }
    return this.getForProfile(profileId)!;
  }

  replaceAllForProfile(profileId: string, prefs: NotificationPreferences | null): void {
    this.driver.run("DELETE FROM notification_preferences WHERE profile_id = ?", [profileId]);
    if (!prefs) return;
    this.driver.run(
      "INSERT INTO notification_preferences (id, profile_id, training_reminders_enabled, secondary_reminder_enabled, secondary_delay_minutes, reminder_style, rest_timer_notifications_enabled, permission_status, permission_prompt_seen, created_at, updated_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [prefs.id, profileId, prefs.trainingRemindersEnabled ? 1 : 0, prefs.secondaryReminderEnabled ? 1 : 0, prefs.secondaryDelayMinutes, prefs.reminderStyle, prefs.restTimerNotificationsEnabled ? 1 : 0, prefs.permissionStatus, prefs.permissionPromptSeen ? 1 : 0, prefs.createdAt, prefs.updatedAt],
    );
  }
}

export class SqliteNotificationJobRepository implements NotificationJobRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  getById(id: string): NotificationJob | null {
    const row = this.driver.get("SELECT * FROM notification_jobs WHERE id = ?", [id]);
    return row ? mapJob(row) : null;
  }

  scheduledForProfile(profileId: string): NotificationJob[] {
    return this.driver
      .all("SELECT * FROM notification_jobs WHERE profile_id = ? AND state = 'scheduled' ORDER BY scheduled_for", [profileId])
      .map(mapJob);
  }

  scheduledByDedupeKey(profileId: string, dedupeKey: string): NotificationJob | null {
    const row = this.driver.get(
      "SELECT * FROM notification_jobs WHERE profile_id = ? AND dedupe_key = ? AND state = 'scheduled'",
      [profileId, dedupeKey],
    );
    return row ? mapJob(row) : null;
  }

  listBySession(profileId: string, scheduledSessionId: string): NotificationJob[] {
    return this.driver
      .all("SELECT * FROM notification_jobs WHERE profile_id = ? AND scheduled_session_id = ? ORDER BY created_at", [profileId, scheduledSessionId])
      .map(mapJob);
  }

  listForProfile(profileId: string): NotificationJob[] {
    return this.driver
      .all("SELECT * FROM notification_jobs WHERE profile_id = ? ORDER BY scheduled_for", [profileId])
      .map(mapJob);
  }

  insert(job: NotificationJob): boolean {
    const result = this.driver.run(
      "INSERT OR IGNORE INTO notification_jobs (id, profile_id, kind, scheduled_session_id, dedupe_key, scheduled_for, platform_notification_id, state, payload_hash, created_at, updated_at, cancelled_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [job.id, job.profileId, job.kind, job.scheduledSessionId, job.dedupeKey, job.scheduledFor, job.platformNotificationId, job.state, job.payloadHash, job.createdAt, job.updatedAt, job.cancelledAt],
    );
    return result.changes === 1;
  }

  updateScheduled(id: string, fields: { scheduledFor: string; payloadHash: string; platformNotificationId: string | null; now: string }): void {
    this.driver.run(
      "UPDATE notification_jobs SET scheduled_for = ?, payload_hash = ?, platform_notification_id = ?, updated_at = ? WHERE id = ?",
      [fields.scheduledFor, fields.payloadHash, fields.platformNotificationId, fields.now, id],
    );
  }

  setPlatformId(id: string, platformNotificationId: string | null, now: string): void {
    this.driver.run(
      "UPDATE notification_jobs SET platform_notification_id = ?, updated_at = ? WHERE id = ?",
      [platformNotificationId, now, id],
    );
  }

  markCancelled(ids: readonly string[], now: string): void {
    for (const id of ids) {
      this.driver.run(
        "UPDATE notification_jobs SET state = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?), platform_notification_id = NULL, updated_at = ? WHERE id = ? AND state = 'scheduled'",
        [now, now, id],
      );
    }
  }

  markExpired(ids: readonly string[], now: string): void {
    for (const id of ids) {
      this.driver.run(
        "UPDATE notification_jobs SET state = 'expired', platform_notification_id = NULL, updated_at = ? WHERE id = ? AND state = 'scheduled'",
        [now, id],
      );
    }
  }

  pruneTerminalBefore(cutoff: string): number {
    const result = this.driver.run(
      "DELETE FROM notification_jobs WHERE state IN ('cancelled', 'expired') AND updated_at < ?",
      [cutoff],
    );
    return result.changes;
  }

  replaceAllForProfile(profileId: string, jobs: readonly NotificationJob[]): void {
    this.driver.run("DELETE FROM notification_jobs WHERE profile_id = ?", [profileId]);
    for (const j of jobs) {
      this.driver.run(
        "INSERT INTO notification_jobs (id, profile_id, kind, scheduled_session_id, dedupe_key, scheduled_for, platform_notification_id, state, payload_hash, created_at, updated_at, cancelled_at)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [j.id, profileId, j.kind, j.scheduledSessionId, j.dedupeKey, j.scheduledFor, j.platformNotificationId, j.state, j.payloadHash, j.createdAt, j.updatedAt, j.cancelledAt],
      );
    }
  }

  countForProfile(profileId: string): number {
    const row = this.driver.get("SELECT COUNT(*) AS n FROM notification_jobs WHERE profile_id = ?", [profileId]);
    return Number(row?.n ?? 0);
  }
}