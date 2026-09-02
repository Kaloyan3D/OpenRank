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