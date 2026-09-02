/**
 * Repository interfaces (Phase 3).
 *
 * Persistence contracts owned by the domain layer; packages/database provides
 * the SQLite implementations. UI never touches SQL - it consumes these.
 *
 * Source-of-truth rules (spec sections 2, 69):
 * - SQLite is canonical for profiles, bodyweight, routines, workouts, sets.
 * - React state is temporary UI state only, never canonical data.
 * - Every meaningful write is transactional; completed sets survive a crash.
 */

import type {
  BodyweightEntry,
  PreviousPerformance,
  Profile,
  RestTimerState,
  SetTargetSnapshot,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "./workout";
import type { Exercise, ExerciseMuscle, MajorGroup, TrackingType } from "./exercise";
import type { Routine, RoutineDetail, RoutineExercise, RoutineSetTarget } from "./routine";
import type {
  ScheduleException,
  ScheduleExceptionType,
  ScheduleWeekday,
  ScheduledSession,
  ScheduledSessionStatus,
  StreakCache,
  StreakDirtyEntityType,
  StreakDirtyReason,
  StreakDirtyRecord,
  StreakEvent,
  StreakEventType,
  TrainingSchedule,
  TrainingScheduleDay,
} from "./streak";
import type { NotificationJob, NotificationPreferences } from "./notifications";
import type {
  PersonalRecord,
  PersonalRecordEvent,
  PersonalRecordType,
  RankDirection,
  RankEvent,
  RankScopeType,
  RankSnapshot,
} from "./derived";

/** Entity kinds the dirty queue tracks (derived-state rebuild inputs). */
export type DerivedEntityType =
  | "workout"
  | "workout_exercise"
  | "workout_set"
  | "bodyweight_entry"
  | "profile";

/** Reason codes for dirty markers (Phase 5 consumes these). */
export type DerivedDirtyReason =
  | "sets_changed"
  | "workout_saved"
  | "workout_completed"
  | "workout_discarded"
  | "bodyweight_changed"
  | "profile_changed";

export interface DerivedDirtyRecord {
  id: string;
  profileId: string | null;
  entityType: DerivedEntityType;
  entityId: string;
  reason: DerivedDirtyReason;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileRepository {
  /** The single local profile, or null before first launch. */
  getDefault(): Profile | null;
  /** Idempotently creates the default local profile (first launch). */
  ensureDefault(): Profile;
  updateDisplayName(id: string, displayName: string): void;
  updateUnitSystem(id: string, unitSystem: "metric" | "imperial"): void;
  updateStrengthStandard(id: string, strengthStandard: "male" | "female"): void;
  completeOnboarding(id: string): void;
  /** Phase 7.1: persist the current onboarding step (null = none/done). */
  setOnboardingStep(id: string, step: string | null): void;
}

// ---------------------------------------------------------------------------
// Bodyweight
// ---------------------------------------------------------------------------

export interface BodyweightAddInput {
  profileId: string;
  /** ISO-8601 UTC instant of the measurement. */
  measuredAt: string;
  /** Kilograms - the canonical unit. */
  weightKg: number;
  source: string;
  note?: string | null;
}

export interface BodyweightRepository {
  add(input: BodyweightAddInput): BodyweightEntry;
  /**
   * Phase 7.1: update a measurement in place (same id and measured_at).
   * Backing for deterministic onboarding semantics: re-entering bodyweight
   * during onboarding updates THE onboarding measurement instead of adding
   * accidental history rows.
   */
  updateWeight(id: string, weightKg: number): void;
  /** Entries for a profile, newest first. */
  history(profileId: string): BodyweightEntry[];
  /**
   * Resolution order: latest measurement at or before the requested instant;
   * otherwise the earliest known measurement; otherwise null. No default or
   * assumed bodyweight is ever invented.
   */
  resolve(profileId: string, atUtc: string): BodyweightEntry | null;
  delete(id: string): void;
}

// ---------------------------------------------------------------------------
// Exercise catalog
// ---------------------------------------------------------------------------

export interface ExerciseSearchOptions {
  query?: string | undefined;
  majorGroup?: MajorGroup | null | undefined;
  equipment?: string | null | undefined;
  trackingType?: TrackingType | null | undefined;
  /** Only exercises that participate in ranking (eligible + provisional). */
  rankSupportedOnly?: boolean | undefined;
  limit?: number | undefined;
}

export interface ExerciseMediaItem {
  id: string;
  exerciseId: string;
  kind: string;
  localPath: string | null;
  remoteUrl: string | null;
  source: string;
  license: string | null;
  attribution: string | null;
}

export interface ExerciseAliasItem {
  id: string;
  alias: string;
  normalizedAlias: string;
  source: string;
}

export interface ExerciseDetail {
  exercise: Exercise;
  muscles: (ExerciseMuscle & { name: string | null })[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  media: ExerciseMediaItem[];
  aliases: ExerciseAliasItem[];
}

export interface ExerciseRepository {
  findById(id: string): Exercise | null;
  findBySlug(slug: string): Exercise | null;
  search(options: ExerciseSearchOptions): Exercise[];
  /** Exercises whose ranking support is eligible or provisional. */
  listRankSupported(): Exercise[];
  /** Resolve a display/import name to an exercise via the alias index. */
  resolveAlias(name: string): Exercise | null;
  getMuscles(exerciseId: string): (ExerciseMuscle & { name: string | null })[];
  getPrimaryMuscleGroups(exerciseId: string): MajorGroup[];
  getInstructions(exerciseId: string): string[];
  getMedia(exerciseId: string): ExerciseMediaItem[];
  getAliases(exerciseId: string): ExerciseAliasItem[];
  /** Full detail aggregate for the exercise details screen. */
  getDetail(exerciseId: string): ExerciseDetail | null;
  /** Create a user-owned custom exercise (UUIDv7 id, is_custom = 1). */
  createCustom(input: CustomExerciseInput): Exercise;
}

export interface CustomExerciseInput {
  name: string;
  category: Exercise["category"];
  mechanic: Exercise["mechanic"];
  force: Exercise["force"];
  equipment: string | null;
  trackingType: TrackingType;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  aliases?: string[];
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export interface RoutineCreateInput {
  profileId: string;
  name: string;
  notes?: string | null;
}

export interface RoutineExerciseAddInput {
  exerciseId: string;
  restSeconds?: number | null;
  supersetGroup?: string | null;
  notes?: string | null;
}

export interface RoutineSetTargetInput {
  setType: RoutineSetTarget["setType"];
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  targetWeightKg?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
}

export interface RoutineRepository {
  create(input: RoutineCreateInput): Routine;
  getById(id: string): RoutineDetail | null;
  list(profileId: string, includeArchived?: boolean): Routine[];
  rename(id: string, name: string): void;
  setNotes(id: string, notes: string | null): void;
  archive(id: string, archivedAtUtc: string): void;
  unarchive(id: string): void;
  delete(id: string): void;
  addExercise(routineId: string, input: RoutineExerciseAddInput): RoutineExercise;
  removeExercise(routineExerciseId: string): void;
  /** Reorder by explicit id sequence (dense positions, transactional). */
  reorderExercises(routineId: string, orderedIds: string[]): void;
  setRestSeconds(routineExerciseId: string, restSeconds: number | null): void;
  setSupersetGroup(routineExerciseId: string, supersetGroup: string | null): void;
  /** Replace the target sets of one routine exercise (transactional). */
  setTargets(routineExerciseId: string, targets: RoutineSetTargetInput[]): RoutineSetTarget[];
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export interface WorkoutCreateInput {
  profileId: string;
  routineId?: string | null;
  title?: string | null;
  /** ISO-8601 UTC start instant. */
  startedAt: string;
  /** Local calendar date (YYYY-MM-DD) at the start instant. */
  startLocalDate: string;
  /** Logical training day (defaults to startLocalDate; WorkoutService computes the 04:00 boundary). */
  logicalTrainingDate?: string | undefined;
  /** Local UTC offset in minutes at the start instant. */
  startTimezoneOffsetMinutes: number;
}

export interface WorkoutSetInput {
  /** Required when creating a set; optional in partial edit updates. */
  setType?: WorkoutSet["setType"];
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  rpe?: number | null;
  rir?: number | null;
  side?: WorkoutSet["side"];
}

export interface WorkoutExerciseDetail {
  workoutExercise: WorkoutExercise;
  sets: WorkoutSet[];
}

export interface WorkoutDetail {
  workout: Workout;
  exercises: WorkoutExerciseDetail[];
}

export interface WorkoutRepository {
  /** Creates the single active workout (conflicts if one is already active). */
  createActive(input: WorkoutCreateInput): Workout;
  /** The profile's active workout, if any (resume path). */
  getActive(profileId: string): WorkoutDetail | null;
  getById(id: string): WorkoutDetail | null;
  /** Completed workouts, newest first. */
  listHistory(profileId: string, limit?: number): WorkoutDetail[];
  updateNotes(id: string, notes: string | null): void;
  setTitle(id: string, title: string | null): void;
  /** Notes on one workout exercise block (autosave commit point). */
  updateExerciseNotes(workoutExerciseId: string, notes: string | null): void;
  /** Adjust rest seconds / superset group of one workout exercise block. */
  updateWorkoutExercise(
    workoutExerciseId: string,
    patch: { restSeconds?: number | null; supersetGroup?: string | null },
  ): void;
  addExercise(workoutId: string, input: RoutineExerciseAddInput): WorkoutExercise;
  removeExercise(workoutExerciseId: string): void;
  reorderExercises(workoutId: string, orderedIds: string[]): void;
  addSet(workoutExerciseId: string, input: WorkoutSetInput, completedAtUtc?: string | null): WorkoutSet;
  updateSet(setId: string, input: Partial<WorkoutSetInput>): WorkoutSet;
  deleteSet(setId: string): void;
  /** Mark a set completed (autosave transaction - no Finish action needed). */
  completeSet(setId: string, completedAtUtc: string): WorkoutSet;
  /** Clear completed_at while keeping the logged values. */
  uncompleteSet(setId: string): WorkoutSet;
  /** Finish the workout (status completed + finished_at). */
  complete(id: string, finishedAtUtc: string): Workout;
  /** Discard without deleting (audit trail). */
  discard(id: string, discardedAtUtc: string): Workout;
  /**
   * Permanently delete an active workout and its sets (discard flow, Phase 4).
   * Cascades to workout_exercises/workout_sets and removes stale dirty
   * markers, all in one transaction.
   */
  deleteActive(id: string): void;
  /**
   * The most relevant prior completed performance for an exercise: the
   * latest completed workout (excluding excludeWorkoutId) that has at least
   * one completed set for it, with those sets in logged order.
   */
  getPreviousPerformance(
    profileId: string,
    exerciseId: string,
    excludeWorkoutId?: string | null,
  ): PreviousPerformance | null;
  /** Recently logged exercise ids (completed or active workouts), newest first. */
  listRecentExerciseIds(profileId: string, limit: number): string[];
  /** Store the routine target snapshot for one workout exercise (start-from-routine). */
  setTargetsSnapshot(workoutExerciseId: string, targets: readonly SetTargetSnapshot[]): void;
}

// ---------------------------------------------------------------------------
// Rest timer (Phase 4) - one row per profile, upsert semantics
// ---------------------------------------------------------------------------

export interface RestTimerStartInput {
  workoutId: string;
  workoutExerciseId?: string | null;
  durationSeconds: number;
  startedAtUtc: string;
}

export interface RestTimerRepository {
  /** Start (or restart) the profile's single rest timer. */
  start(profileId: string, input: RestTimerStartInput): void;
  /** Shift the end instant by deltaSeconds (positive extends, negative shortens). */
  adjustEnd(profileId: string, deltaSeconds: number): void;
  /** The current timer with derived remaining/expired fields, or null. */
  get(profileId: string, nowUtcIso: string): RestTimerState | null;
  /** Clear the timer (skip, finish, discard). */
  clear(profileId: string): void;
  /** Clear the timer only if it belongs to the given workout. */
  clearIfWorkout(profileId: string, workoutId: string): void;
}

// ---------------------------------------------------------------------------
// Derived dirty queue
// ---------------------------------------------------------------------------

export interface DerivedStateRepository {
  /** Mark an entity as requiring recalculation (idempotent per reason). */
  mark(
    profileId: string | null,
    entityType: DerivedEntityType,
    entityId: string,
    reason: DerivedDirtyReason,
  ): void;
  /** All pending markers (oldest first), optionally for one profile. */
  list(profileId?: string | null): DerivedDirtyRecord[];
  count(profileId?: string | null): number;
  /** Remove markers after successful recalculation. */
  clear(ids: string[]): void;
  clearAll(): void;
}
// ---------------------------------------------------------------------------
// Derived state (Phase 5): rebuildable caches owned by the DerivedDataWorker
// ---------------------------------------------------------------------------

export interface PersonalRecordRepository {
  /** The current best row for one record key. */
  best(
    profileId: string,
    exerciseId: string,
    recordType: PersonalRecordType,
    qualifierKey: string,
  ): PersonalRecord | null;
  /**
   * Insert or update the current-best row. Returns "inserted", "updated" or
   * "unchanged" (strictly-better values only; equality keeps provenance).
   */
  upsertBest(record: PersonalRecord): "inserted" | "updated" | "unchanged";
  /** Records of one exercise (all types), for the exercise detail screen. */
  listForExercise(profileId: string, exerciseId: string): PersonalRecord[];
  listForProfile(profileId: string): PersonalRecord[];
  /** Deterministic full-replace (rebuild path). */
  replaceAllForProfile(profileId: string, records: readonly PersonalRecord[]): void;
  appendEvent(event: PersonalRecordEvent): void;
  replaceAllEventsForProfile(profileId: string, events: readonly PersonalRecordEvent[]): void;
  listEventsForExercise(profileId: string, exerciseId: string, limit?: number): PersonalRecordEvent[];
  /** "Which PRs were achieved by this workout?" (workout summary). */
  listEventsForWorkout(workoutId: string): PersonalRecordEvent[];
  /** Recent PR events across all exercises, newest first (Home wins feed). */
  listEventsForProfile(profileId: string, limit?: number): PersonalRecordEvent[];
}

export interface RankSnapshotRepository {
  latest(profileId: string, scopeType: RankScopeType, scopeKey: string): RankSnapshot | null;
  /** Current state: latest snapshot per scope (insert order = chronology). */
  latestForProfile(profileId: string): RankSnapshot[];
  history(profileId: string, scopeType: RankScopeType, scopeKey: string): RankSnapshot[];
  /**
   * Insert a snapshot; an existing snapshot for the same
   * (profile, scope, source_workout) is replaced - re-derivation with changed
   * inputs legitimately supersedes it and never duplicates rows.
   */
  upsert(snapshot: RankSnapshot): void;
  replaceAllForProfile(profileId: string, snapshots: readonly RankSnapshot[]): void;
}

export interface RankEventRepository {
  append(event: RankEvent): void;
  /**
   * Transition events for one scope, chronological (rank timeline).
   */
  historyForScope(profileId: string, scopeType: RankScopeType, scopeKey: string): RankEvent[];
  /** Most recent transitions across all scopes. */
  listForProfile(profileId: string, limit?: number): RankEvent[];
  listForWorkout(workoutId: string): RankEvent[];
  replaceAllForProfile(profileId: string, events: readonly RankEvent[]): void;
  /** Distinct scope keys that have at least one event (repair checks). */
  countForProfile(profileId: string): number;
}

export type { RankDirection };

// ---------------------------------------------------------------------------
// Training schedule + streak (Phase 6)
// ---------------------------------------------------------------------------

export interface TrainingScheduleRepository {
  getForProfile(profileId: string): TrainingSchedule | null;
  /** Idempotently creates the profile schedule (disabled, all days off, revision 1). */
  ensureDefault(profileId: string): TrainingSchedule;
  setEnabled(scheduleId: string, enabled: boolean): void;
  /** Bumps revision and returns the new value (spec F). */
  bumpRevision(scheduleId: string): number;
  getDays(scheduleId: string): TrainingScheduleDay[];
  /** Keyed (schedule_id, weekday) upsert; exactly one row per weekday. */
  upsertDay(scheduleId: string, day: { weekday: ScheduleWeekday; enabled: boolean; routineId: string | null; reminderMinutesAfterMidnight?: number | null }): void;
  /**
   * Phase 7: per-day reminder time (notification configuration). Deliberately
   * does NOT touch enabled/routineId or the attendance revision (spec E).
   */
  setDayReminder(scheduleId: string, weekday: ScheduleWeekday, reminderMinutesAfterMidnight: number | null): void;
  replaceAllForProfile(profileId: string, schedule: TrainingSchedule | null, days: readonly TrainingScheduleDay[]): void;
}

export interface ScheduledSessionRepository {
  getById(id: string): ScheduledSession | null;
  /** Linked session for a completed workout, if any (summary + idempotency). */
  forWorkout(workoutId: string): ScheduledSession | null;
  /** All sessions for a date, any status. */
  forDate(profileId: string, scheduledDate: string): ScheduledSession[];
  /** First ACTIVE (pending/completed/missed/paused) session on a date. */
  activeForDate(profileId: string, scheduledDate: string): ScheduledSession | null;
  firstPendingOnDate(profileId: string, scheduledDate: string): ScheduledSession | null;
  /** Chronological full ledger (streak walks + history UI). */
  forProfile(profileId: string): ScheduledSession[];
  pendingFrom(profileId: string, fromDate: string): ScheduledSession[];
  /**
   * Idempotent generation: INSERT OR IGNORE under the partial unique index on
   * (profile_id, scheduled_date) for active statuses. Returns true when a new
   * row was created.
   */
  generateIfMissing(session: {
    id: string;
    profileId: string;
    scheduledDate: string;
    routineId: string | null;
    scheduleRevision: number;
    now: string;
    /** Defaults to scheduledDate; reschedule targets keep the very original. */
    originalDate?: string | undefined;
    /** Set on reschedule targets (provenance). */
    rescheduledFromDate?: string | null | undefined;
  }): boolean;
  setStatus(sessionId: string, status: ScheduledSessionStatus, now: string): void;
  /**
   * Phase 7 hardening: first SYSTEM-inactivated (missed/paused/cancelled)
   * session on a date whose pending-until instant is still at/after the given
   * instant - i.e. the obligation was still valid when the referenced
   * completion happened, regardless of asynchronous processing order.
   */
  firstInactiveButValidOnDate(profileId: string, scheduledDate: string, atInstant: string): ScheduledSession | null;
  linkCompletion(sessionId: string, workoutId: string, completedAt: string, now: string): void;
  setStreakAfter(sessionId: string, streakAfter: number): void;
  replaceAllForProfile(profileId: string, sessions: readonly ScheduledSession[]): void;
  countForProfile(profileId: string): number;
}

export interface ScheduleExceptionRepository {
  getById(id: string): ScheduleException | null;
  add(exception: { profileId: string; startDate: string; endDate: string; type: ScheduleExceptionType; reason: string | null; now: string }): ScheduleException;
  remove(id: string): void;
  listForProfile(profileId: string): ScheduleException[];
  /** Pauses overlapping the given date (pause overlay). */
  listOverlapping(profileId: string, date: string): ScheduleException[];
  replaceAllForProfile(profileId: string, exceptions: readonly ScheduleException[]): void;
}

export interface StreakCacheRepository {
  get(profileId: string): StreakCache | null;
  upsert(cache: StreakCache): void;
  replaceAllForProfile(profileId: string, caches: readonly StreakCache[]): void;
}

export interface StreakEventRepository {
  /** Stable-identity append: duplicates are ignored, never re-celebrated. */
  append(event: StreakEvent): void;
  byKey(profileId: string, type: StreakEventType, key: string): StreakEvent | null;
  listForProfile(profileId: string): StreakEvent[];
  listByType(profileId: string, type: StreakEventType): StreakEvent[];
  replaceAllForProfile(profileId: string, events: readonly StreakEvent[]): void;
  countForProfile(profileId: string): number;
}

export interface NotificationPreferencesRepository {
  getForProfile(profileId: string): NotificationPreferences | null;
  /** Conservative defaults: everything disabled, style normal (spec D). */
  ensureDefault(profileId: string): NotificationPreferences;
  update(profileId: string, patch: Partial<Pick<NotificationPreferences, "trainingRemindersEnabled" | "secondaryReminderEnabled" | "secondaryDelayMinutes" | "reminderStyle" | "restTimerNotificationsEnabled" | "permissionStatus" | "permissionPromptSeen">>): NotificationPreferences;
  replaceAllForProfile(profileId: string, prefs: NotificationPreferences | null): void;
}

export interface NotificationJobRepository {
  getById(id: string): NotificationJob | null;
  /** All currently scheduled jobs for a profile (reconciliation input). */
  scheduledForProfile(profileId: string): NotificationJob[];
  scheduledByDedupeKey(profileId: string, dedupeKey: string): NotificationJob | null;
  listBySession(profileId: string, scheduledSessionId: string): NotificationJob[];
  listForProfile(profileId: string): NotificationJob[];
  /** INSERT OR IGNORE under the partial unique index on scheduled rows. */
  insert(job: NotificationJob): boolean;
  /** Update scheduling intent on an existing scheduled job (drift repair). */
  updateScheduled(id: string, fields: { scheduledFor: string; payloadHash: string; platformNotificationId: string | null; now: string }): void;
  setPlatformId(id: string, platformNotificationId: string | null, now: string): void;
  markCancelled(ids: readonly string[], now: string): void;
  markExpired(ids: readonly string[], now: string): void;
  /** Bounded retention (spec AJ): delete terminal rows older than cutoff. */
  pruneTerminalBefore(cutoff: string): number;
  replaceAllForProfile(profileId: string, jobs: readonly NotificationJob[]): void;
  countForProfile(profileId: string): number;
}

export interface StreakDirtyRepository {
  /** INSERT OR IGNORE under UNIQUE(profile, entity_type, entity_id, reason). */
  mark(profileId: string | null, entityType: StreakDirtyEntityType, entityId: string, reason: StreakDirtyReason): void;
  list(profileId?: string | null): StreakDirtyRecord[];
  clear(ids: readonly string[]): void;
  clearAll(): void;
  count(): number;
}