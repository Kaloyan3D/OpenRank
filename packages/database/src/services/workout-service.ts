/**
 * Workout service (Phase 4) - the application layer between UI and
 * repositories.
 *
 * Layering: UI -> services -> repositories -> SQLite. Screens never talk to
 * repositories directly and never hold canonical workout state.
 *
 * Session model:
 * - at most one active workout per profile (enforced by SQLite; the service
 *   turns conflicts into a structured ActiveWorkoutConflictError so the UI
 *   can present resume / discard+restart / cancel choices);
 * - starting from a routine SNAPSHOTS the routine structure into the workout
 *   (order, rest, superset groups, target sets) - later routine edits never
 *   mutate started or finished workouts;
 * - finishing validates + completes + clears the rest timer in ONE
 *   transaction; discarding deletes the active workout (cascades) and cleans
 *   its dirty markers;
 * - set completion is one atomic logical operation: validate -> persist ->
 *   completed_at -> dirty markers -> rest timer -> commit.
 */

import type {
  Exercise,
  PreviousPerformance,
  RestTimerState,
  ProfileRepository,
  ExerciseRepository,
  RoutineExerciseAddInput,
  RoutineRepository,
  SetTargetSnapshot,
  Workout,
  WorkoutDetail,
  WorkoutExercise,
  WorkoutExerciseDetail,
  WorkoutRepository,
  WorkoutSet,
  WorkoutSetInput,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { nowUtc } from "../rows";
import { ActiveWorkoutConflictError, IncompleteSetsError } from "./errors";
import { computeLogicalTrainingDate, computeStartLocalDate } from "./logical-date";
import { validateSetForCompletion, validateSetInput } from "./set-validation";

export interface WorkoutServiceRepos {
  profile: ProfileRepository;
  exercise: ExerciseRepository;
  routine: RoutineRepository;
  workout: WorkoutRepository;
}

export interface WorkoutStartOptions {
  startedAtUtc?: string | undefined;
  /** Local UTC offset in minutes at the start instant (device timezone). */
  timezoneOffsetMinutes?: number | undefined;
  title?: string | undefined;
}

/** Canonical, non-derived workout summary (Phase 4 version - no PRs/ranks). */
export interface WorkoutSummary {
  workout: Workout;
  durationSeconds: number;
  completedSetCount: number;
  totalSetCount: number;
  exerciseCount: number;
  /** Basic training statistic: sum(weight_kg x reps) over completed sets. */
  volumeKg: number;
  exercises: { exerciseId: string; name: string; sets: WorkoutSet[] }[];
}

export interface FinishOptions {
  finishedAtUtc?: string | undefined;
  /** "reject" throws IncompleteSetsError; "remove" deletes incomplete rows. */
  incompleteSetPolicy: "remove" | "reject";
}

export interface CompleteSetResult {
  set: WorkoutSet;
  /** The rest timer state started by this completion, if any. */
  rest: RestTimerState | null;
}

export class WorkoutService {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly repos: WorkoutServiceRepos,
    private readonly restTimer: {
      start(profileId: string, workoutId: string, seconds: number, weId?: string | null): void;
      getActive(profileId: string): RestTimerState | null;
      clearForWorkout(profileId: string, workoutId: string): void;
    },
    private readonly now: () => string = nowUtc,
    /**
     * Phase 6: optional streak/schedule repair hook. Marked INSIDE the finish
     * transaction so the repair intent survives a crash before processing
     * (spec R/S/BB). The streak projection itself never runs here - workout
     * completion stays canonical-first and cannot fail because of it.
     */
    private readonly streakDirty?: {
      mark(profileId: string | null, entityType: "workout" | "schedule" | "exception", entityId: string, reason: "workout_completed" | "schedule_changed" | "schedule_enabled_changed" | "exception_changed" | "session_rescheduled"): void;
    } | null,
  ) {}

  // ------------------------------------------------------------ lifecycle --

  /** Start a freestyle (empty) workout. Conflicts with an active workout. */
  startEmptyWorkout(profileId: string, options: WorkoutStartOptions = {}): Workout {
    this.assertNoActiveWorkout(profileId);
    const startedAt = options.startedAtUtc ?? this.now();
    const offset = options.timezoneOffsetMinutes ?? 0;
    return this.repos.workout.createActive({
      profileId,
      title: options.title ?? null,
      startedAt,
      startLocalDate: computeStartLocalDate(startedAt, offset),
      logicalTrainingDate: computeLogicalTrainingDate(startedAt, offset),
      startTimezoneOffsetMinutes: offset,
    });
  }

  /**
   * Start a workout from a routine: snapshot the routine structure (order,
   * rest seconds, superset groups, target sets) into the workout. The
   * workout owns its session structure from this instant on.
   */
  startWorkoutFromRoutine(
    profileId: string,
    routineId: string,
    options: WorkoutStartOptions = {},
  ): Workout {
    this.assertNoActiveWorkout(profileId);
    const detail = this.repos.routine.getById(routineId);
    if (!detail) throw new Error("routine not found: " + routineId);
    const startedAt = options.startedAtUtc ?? this.now();
    const offset = options.timezoneOffsetMinutes ?? 0;
    const workout = this.repos.workout.createActive({
      profileId,
      routineId,
      title: options.title ?? detail.routine.name,
      startedAt,
      startLocalDate: computeStartLocalDate(startedAt, offset),
      logicalTrainingDate: computeLogicalTrainingDate(startedAt, offset),
      startTimezoneOffsetMinutes: offset,
    });
    this.driver.transaction(() => {
      for (const re of detail.exercises) {
        const we = this.repos.workout.addExercise(workout.id, {
          exerciseId: re.exerciseId,
          restSeconds: re.restSeconds,
          supersetGroup: re.supersetGroup,
          notes: re.notes,
        });
        if (re.targets.length > 0) {
          const snapshot: SetTargetSnapshot[] = re.targets.map((t) => ({
            setType: t.setType,
            targetRepsMin: t.targetRepsMin,
            targetRepsMax: t.targetRepsMax,
            targetWeightKg: t.targetWeightKg,
            targetRpe: t.targetRpe,
            targetRir: t.targetRir,
          }));
          this.repos.workout.setTargetsSnapshot(we.id, snapshot);
        }
      }
    });
    return this.repos.workout.getById(workout.id)!.workout;
  }

  /** The active workout to resume, if any. */
  resumeActiveWorkout(profileId: string): WorkoutDetail | null {
    return this.repos.workout.getActive(profileId);
  }

  /**
   * Finish the workout: validate, persist status+finished_at, clear the rest
   * timer - one transaction. Incomplete set rows are either removed first
   * (policy "remove") or rejected (policy "reject"); empty rows are never
   * silently converted into completed sets.
   */
  finishWorkout(workoutId: string, options: FinishOptions): WorkoutSummary {
    const detail = this.require(workoutId);
    if (detail.workout.status !== "active") {
      throw new Error("workout is not active (" + detail.workout.status + ")");
    }
    const incomplete = detail.exercises
      .flatMap((e) => e.sets)
      .filter((s) => s.completedAt == null);
    if (incomplete.length > 0 && options.incompleteSetPolicy === "reject") {
      throw new IncompleteSetsError(incomplete.length);
    }
    const finishedAt = options.finishedAtUtc ?? this.now();
    this.driver.transaction(() => {
      for (const s of incomplete) this.repos.workout.deleteSet(s.id);
      this.repos.workout.complete(workoutId, finishedAt);
      this.restTimer.clearForWorkout(detail.workout.profileId, workoutId);
      this.streakDirty?.mark(detail.workout.profileId, "workout", workoutId, "workout_completed");
    });
    return this.getSummary(workoutId);
  }

  /** Discard (permanent delete) with confirmation handled by the UI. */
  discardWorkout(workoutId: string): void {
    const detail = this.require(workoutId);
    if (detail.workout.status !== "active") {
      throw new Error("workout is not active (" + detail.workout.status + ")");
    }
    this.driver.transaction(() => {
      this.restTimer.clearForWorkout(detail.workout.profileId, workoutId);
      this.repos.workout.deleteActive(workoutId);
    });
  }

  // ----------------------------------------------------------------- sets --

  /**
   * Add a set. If completedAtUtc is provided the set is validated for its
   * tracking type and persisted completed - one atomic operation.
   */
  addSet(
    workoutExerciseId: string,
    input: WorkoutSetInput & { setType?: WorkoutSetInput["setType"] },
    completedAtUtc?: string | null,
  ): WorkoutSet {
    const ctx = this.setContext(workoutExerciseId);
    validateSetInput(ctx.trackingType, input);
    if (completedAtUtc) {
      validateSetForCompletion(ctx.trackingType, {
        weightKg: input.weightKg ?? null,
        reps: input.reps ?? null,
        durationSeconds: input.durationSeconds ?? null,
        distanceMeters: input.distanceMeters ?? null,
        rpe: input.rpe ?? null,
        rir: input.rir ?? null,
      });
    }
    return this.repos.workout.addSet(
      workoutExerciseId,
      { ...input, setType: input.setType ?? "normal" },
      completedAtUtc ?? null,
    );
  }

  /** Edit a set (autosave commit point). Validates provided fields. */
  updateSet(setId: string, input: Partial<WorkoutSetInput>): WorkoutSet {
    const weId = this.workoutExerciseOfSet(setId);
    const ctx = this.setContext(weId);
    validateSetInput(ctx.trackingType, input);
    return this.repos.workout.updateSet(setId, input);
  }

  /**
   * Complete a set - one atomic logical operation (task L): validate the
   * persisted values, set completed_at, emit dirty markers (repository),
   * start the rest timer when the exercise declares rest_seconds > 0.
   */
  completeSet(setId: string, completedAtUtc?: string): CompleteSetResult {
    const weId = this.workoutExerciseOfSet(setId);
    const ctx = this.setContext(weId);
    const current = this.findSet(ctx.workoutId, setId);
    validateSetForCompletion(ctx.trackingType, current);
    let rest: RestTimerState | null = null;
    this.driver.transaction(() => {
      const completed = this.repos.workout.completeSet(setId, completedAtUtc ?? this.now());
      if (ctx.restSeconds != null && ctx.restSeconds > 0) {
        this.restTimer.start(ctx.profileId, ctx.workoutId, ctx.restSeconds, weId);
        rest = this.restTimer.getActive(ctx.profileId);
      }
      void completed;
    });
    return { set: this.findSet(ctx.workoutId, setId), rest };
  }

  /** Un-complete a set (keep the values). */
  uncompleteSet(setId: string): WorkoutSet {
    return this.repos.workout.uncompleteSet(setId);
  }

  deleteSet(setId: string): void {
    this.repos.workout.deleteSet(setId);
  }

  /** Exercise-level notes (autosave commit point). */
  updateExerciseNotes(workoutExerciseId: string, notes: string | null): void {
    this.repos.workout.updateExerciseNotes(workoutExerciseId, notes);
  }

  /**
   * Phase 8.2: canonical add-exercise flows through the service layer (the
   * exercise picker is UI and must never mutate the workout repository
   * directly). Behavior-preserving delegation; the repository remains the
   * only SQL consumer and keeps ownership of ordering.
   */
  addExercise(workoutId: string, input: RoutineExerciseAddInput): WorkoutExercise {
    return this.repos.workout.addExercise(workoutId, input);
  }

  /**
   * Phase 7.1: canonical workout-exercise mutations move behind the service
   * layer (UI -> service -> repository -> SQLite). Behavior-preserving
   * delegation; the repository remains the only SQL consumer and keeps
   * ownership of derived dirty markers.
   */
  removeExercise(workoutExerciseId: string): void {
    this.repos.workout.removeExercise(workoutExerciseId);
  }

  reorderExercises(workoutId: string, orderedIds: string[]): void {
    this.repos.workout.reorderExercises(workoutId, orderedIds);
  }

  updateSuperset(workoutExerciseId: string, supersetGroup: string | null): void {
    this.repos.workout.updateWorkoutExercise(workoutExerciseId, { supersetGroup });
  }

  updateWorkoutNotes(workoutId: string, notes: string | null): void {
    this.repos.workout.updateNotes(workoutId, notes);
  }

  // ------------------------------------------------------- read-side APIs --

  /** Previous completed performance for an exercise (most relevant prior). */
  getPreviousPerformance(
    profileId: string,
    exerciseId: string,
    excludeWorkoutId?: string | null,
  ): PreviousPerformance | null {
    return this.repos.workout.getPreviousPerformance(profileId, exerciseId, excludeWorkoutId);
  }

  /** Recently logged exercises for the picker, newest first. */
  getRecentExercises(profileId: string, limit = 8): Exercise[] {
    const ids = this.repos.workout.listRecentExerciseIds(profileId, limit);
    return ids
      .map((id) => this.repos.exercise.findById(id))
      .filter((e): e is Exercise => e !== null);
  }

  /** Canonical summary (no derived data - Phase 4). */
  getSummary(workoutId: string): WorkoutSummary {
    const detail = this.require(workoutId);
    const byId = new Map<string, string>();
    for (const e of detail.exercises) {
      const ex = this.repos.exercise.findById(e.workoutExercise.exerciseId);
      if (ex) byId.set(e.workoutExercise.exerciseId, ex.name);
    }
    let completedSetCount = 0;
    let volumeKg = 0;
    const exercises: WorkoutSummary["exercises"] = [];
    for (const e of detail.exercises) {
      const completed = e.sets.filter((s) => s.completedAt != null);
      completedSetCount += completed.length;
      for (const s of completed) {
        if (s.weightKg != null && s.reps != null) volumeKg += s.weightKg * s.reps;
      }
      exercises.push({
        exerciseId: e.workoutExercise.exerciseId,
        name: byId.get(e.workoutExercise.exerciseId) ?? "Exercise",
        sets: completed,
      });
    }
    const started = Date.parse(detail.workout.startedAt);
    const ended = detail.workout.finishedAt
      ? Date.parse(detail.workout.finishedAt)
      : Date.parse(this.now());
    return {
      workout: detail.workout,
      durationSeconds: Math.max(0, Math.round((ended - started) / 1000)),
      completedSetCount,
      totalSetCount: detail.exercises.reduce((n, e) => n + e.sets.length, 0),
      exerciseCount: detail.exercises.length,
      volumeKg: Math.round(volumeKg * 10) / 10,
      exercises,
    };
  }

  /** History for the history screen (completed only, newest first). */
  listHistory(profileId: string, limit?: number): WorkoutDetail[] {
    return this.repos.workout.listHistory(profileId, limit);
  }

  getWorkout(workoutId: string): WorkoutDetail {
    return this.require(workoutId);
  }

  // -------------------------------------------------------------- private --

  private assertNoActiveWorkout(profileId: string): void {
    const active = this.repos.workout.getActive(profileId);
    if (active) throw new ActiveWorkoutConflictError(active.workout.id);
  }

  private require(workoutId: string): WorkoutDetail {
    const detail = this.repos.workout.getById(workoutId);
    if (!detail) throw new Error("workout not found: " + workoutId);
    return detail;
  }

  private setContext(workoutExerciseId: string): {
    workoutId: string;
    profileId: string;
    exerciseId: string;
    trackingType: Exercise["trackingType"];
    restSeconds: number | null;
  } {
    const row = this.driver.get(
      "SELECT we.exercise_id AS exercise_id, we.rest_seconds AS rest_seconds, " +
        "w.id AS workout_id, w.profile_id AS profile_id " +
        "FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE we.id = ?",
      [workoutExerciseId],
    );
    if (!row) throw new Error("workout exercise not found: " + workoutExerciseId);
    const exercise = this.repos.exercise.findById(String(row.exercise_id));
    if (!exercise) throw new Error("exercise not found: " + String(row.exercise_id));
    return {
      workoutId: String(row.workout_id),
      profileId: String(row.profile_id),
      exerciseId: String(row.exercise_id),
      trackingType: exercise.trackingType,
      restSeconds: row.rest_seconds == null ? null : Number(row.rest_seconds),
    };
  }

  private workoutExerciseOfSet(setId: string): string {
    const row = this.driver.get(
      "SELECT workout_exercise_id FROM workout_sets WHERE id = ?",
      [setId],
    );
    if (!row) throw new Error("set not found: " + setId);
    return String(row.workout_exercise_id);
  }

  private findSet(workoutId: string, setId: string): WorkoutSet {
    const detail = this.require(workoutId);
    const all: WorkoutExerciseDetail[] = detail.exercises;
    for (const e of all) {
      const found = e.sets.find((s) => s.id === setId);
      if (found) return found;
    }
    throw new Error("set not found: " + setId);
  }
}