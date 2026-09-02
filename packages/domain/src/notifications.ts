/**
 * Notification domain types (Phase 7).
 *
 * Notifications are a derived, entirely LOCAL delivery layer on top of the
 * materialized scheduled_sessions ledger. The database represents scheduling
 * intent and reconciliation state - never proof of on-screen delivery.
 */

export type ReminderStyle = "gentle" | "normal" | "competitive";

/** Last-known OS permission state (mirrored into preferences for the UI). */
export type NotificationPermissionStatus = "undetermined" | "granted" | "denied";

export interface NotificationPreferences {
  id: string;
  profileId: string;
  /** Conservative default: training reminders OFF until the user opts in. */
  trainingRemindersEnabled: boolean;
  /** Optional second reminder (max 2 training reminders per session, spec N). */
  secondaryReminderEnabled: boolean;
  /** Minutes after the primary reminder (bounded; secondary must stay inside the logical day). */
  secondaryDelayMinutes: number;
  reminderStyle: ReminderStyle;
  /** Rest-complete notification: optional delivery only (spec AB). */
  restTimerNotificationsEnabled: boolean;
  permissionStatus: NotificationPermissionStatus;
  /** Whether the user has seen the pre-permission explainer (spec V). */
  permissionPromptSeen: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NotificationJobKind = "training_primary" | "training_secondary" | "rest_timer";

/** States describe reconciliation intent, not observed delivery. */
export type NotificationJobState = "scheduled" | "cancelled" | "expired";

export interface NotificationJob {
  id: string;
  profileId: string;
  kind: NotificationJobKind;
  /** Ledger link for training jobs; null for rest-timer jobs. */
  scheduledSessionId: string | null;
  /** Stable dedupe identity (idempotency, spec H): "<sessionId>:<kind>" | "rest:<workoutId>". */
  dedupeKey: string;
  /** Absolute ISO instant the OS should present the notification. */
  scheduledFor: string;
  platformNotificationId: string | null;
  state: NotificationJobState;
  /** Hash of (kind, scheduledFor, title, body, payload) - drift detection (spec AK). */
  payloadHash: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

/** Validated notification tap payload (spec AG) - stable ids, never display text. */
export interface NotificationPayload {
  type: "training_reminder" | "rest_timer";
  profileId: string;
  /** training_reminder only. */
  scheduledSessionId?: string;
  /** rest_timer only. */
  workoutId?: string;
}
