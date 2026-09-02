/**
 * Streak domain types (Phase 6).
 *
 * A streak is the number of consecutively completed REQUIRED scheduled
 * sessions. Rest days neither increment nor break it; bonus (unscheduled)
 * workouts neither increment nor break it; missed scheduled sessions reset
 * it to zero. Scheduled sessions (the ledger) are the historical truth; the
 * streak cache is a rebuildable projection.
 */

/** ISO weekday: 1 = Monday ... 7 = Sunday (never JS Sunday=0 semantics). */
export type ScheduleWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Ledger statuses:
 * - pending: generated obligation, not yet due or satisfied
 * - completed: linked to a completed workout
 * - missed: pending whose training-day window definitively passed
 * - paused: inside a planned pause (vacation) - neutral to the streak
 * - rescheduled: source occurrence of a move; neutral (the target row is the
 *   one true obligation)
 * - cancelled: reconciled away (schedule disabled); never historical truth
 */
export type ScheduledSessionStatus =
  | "pending"
  | "completed"
  | "missed"
  | "paused"
  | "rescheduled"
  | "cancelled";

/** Statuses that occupy a date (uniqueness + matching); moved/cancelled rows do not. */
export type ActiveSessionStatus = "pending" | "completed" | "missed" | "paused";

export interface TrainingSchedule {
  id: string;
  profileId: string;
  enabled: boolean;
  /** Local logical-day boundary in minutes (default 240 = 04:00). v1 always uses 240. */
  dayBoundaryMinutes: number;
  createdAt: string;
  updatedAt: string;
  /** Bumped on every meaningful weekly configuration change (spec F). */
  revision: number;
}

export interface TrainingScheduleDay {
  id: string;
  scheduleId: string;
  weekday: ScheduleWeekday;
  enabled: boolean;
  /** Optional planned routine - context only, never an attendance requirement. */
  routineId: string | null;
  /**
   * Notification configuration (Phase 7): local minutes after midnight for the
   * reminder of this training day. NULL = no reminder time set for the day.
   * Deliberately NOT part of attendance revision semantics (spec E).
   */
  reminderMinutesAfterMidnight: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledSession {
  id: string;
  profileId: string;
  /** Date the session was first generated for (never changes). */
  originalDate: string;
  /** Effective obligation date (differs from originalDate after a reschedule). */
  scheduledDate: string;
  routineId: string | null;
  status: ScheduledSessionStatus;
  /** Schedule revision the obligation was generated from (spec F). */
  scheduleRevision: number;
  workoutId: string | null;
  completedAt: string | null;
  /** Reschedule provenance: the date this obligation moved FROM (target rows only). */
  rescheduledFromDate: string | null;
  /** Read model: running streak value after this completed session (projection). */
  streakAfter: number | null;
  /**
   * Phase 7 hardening (temporal validity): the instant this session stopped
   * being pending through a SYSTEM-driven transition (missed / paused /
   * cancelled). NULL while pending and for user-declared neutral states
   * (rescheduled). Deterministic attendance semantics: a completed workout
   * satisfies an inactive session iff pendingUntil >= workout.finishedAt.
   */
  pendingUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleExceptionType = "pause";

export interface ScheduleException {
  id: string;
  profileId: string;
  startDate: string;
  endDate: string;
  type: ScheduleExceptionType;
  /** Informational only; never required. */
  reason: string | null;
  createdAt: string;
}

export interface StreakCache {
  profileId: string;
  currentStreak: number;
  bestStreak: number;
  perfectWeeks: number;
  lastCompletedSessionId: string | null;
  recalculatedAt: string | null;
}

export type StreakEventType = "milestone" | "broken" | "new_best";

export interface StreakEvent {
  id: string;
  profileId: string;
  type: StreakEventType;
  /** Stable event identity: "milestone:<n>" | "broken:<sessionId>" | "new_best:<n>". */
  key: string;
  /** Milestone value / new-best value; 0 for broken. */
  value: number;
  occurredAt: string;
  createdAt: string;
}

export type StreakDirtyEntityType = "workout" | "schedule" | "exception";

export type StreakDirtyReason =
  | "workout_completed"
  | "schedule_changed"
  | "schedule_enabled_changed"
  | "exception_changed"
  | "session_rescheduled";

export interface StreakDirtyRecord {
  id: string;
  profileId: string | null;
  entityType: StreakDirtyEntityType;
  entityId: string;
  reason: StreakDirtyReason;
  createdAt: string;
}