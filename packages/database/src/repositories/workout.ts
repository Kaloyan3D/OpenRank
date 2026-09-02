/**
 * Workout repository (SQLite implementation).
 *
 * Crash-safety contract (spec section 20): every meaningful write is its own
 * transaction and persists immediately - completing a set never waits for a
 * "Finish Workout" action. Every canonical change also marks derived state
 * dirty (same transaction: canonical row + dirty marker commit atomically).
 */

import type {
  DerivedStateRepository,
  RoutineExerciseAddInput,
  Workout,
  WorkoutCreateInput,
  WorkoutDetail,
  WorkoutExercise,
  WorkoutExerciseDetail,
  WorkoutRepository,
  WorkoutSet,
  WorkoutSetInput,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { mapWorkout, mapWorkoutExercise, mapWorkoutSet, nowUtc } from "../rows";

interface SetRowRef {
  workout_exercise_id: unknown;
}

export class SqliteWorkoutRepository implements WorkoutRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly dirty: DerivedStateRepository,
    private readonly newId: () => string,
  ) {}

  createActive(input: WorkoutCreateInput): Workout {
    const id = this.newId();
    const now = nowUtc();
    try {
      this.driver.run(
        "INSERT INTO workouts (id, profile_id, routine_id, title, status, started_at, finished_at, " +
          "start_local_date, logical_training_date, start_timezone_offset_minutes, notes, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?, NULL, ?, ?)",
        [
          id, input.profileId, input.routineId ?? null, input.title ?? null,
          input.startedAt, input.startLocalDate, input.startLocalDate,
          input.startTimezoneOffsetMinutes, now, now,
        ],
      );
    } catch (err) {
      throw new Error(
        "could not start a workout (is one already active?): " + String(err instanceof Error ? err.message : err),
      );
    }
    this.dirty.mark(input.profileId, "workout", id, "workout_saved");
    return this.requireWorkout(id);
  }

  getActive(profileId: string): WorkoutDetail | null {
    const row = this.driver.get(
      "SELECT * FROM workouts WHERE profile_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
      [profileId],
    );
    return row ? this.getById(String(row.id)) : null;
  }

  getById(id: string): WorkoutDetail | null {
    const row = this.driver.get("SELECT * FROM workouts WHERE id = ?", [id]);
    if (!row) return null;
    const workout = mapWorkout(row);
    const exercises: WorkoutExerciseDetail[] = this.driver
      .all("SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position", [id])
      .map(mapWorkoutExercise)
      .map((we) => ({ workoutExercise: we, sets: this.setsFor(we.id) }));
    return { workout, exercises };
  }

  listHistory(profileId: string, limit?: number): WorkoutDetail[] {
    const sql =
      "SELECT id FROM workouts WHERE profile_id = ? AND status = 'completed' " +
      "ORDER BY started_at DESC, id DESC" +
      (limit != null ? " LIMIT " + String(Math.trunc(limit)) : "");
    return this.driver
      .all(sql, [profileId])
      .map((r) => this.getById(String(r.id)))
      .filter((d): d is WorkoutDetail => d !== null);
  }

  updateNotes(id: string, notes: string | null): void {
    this.touch(id, { notes });
  }

  setTitle(id: string, title: string | null): void {
    this.touch(id, { title });
  }

  addExercise(workoutId: string, input: RoutineExerciseAddInput): WorkoutExercise {
    const id = this.newId();
    this.driver.transaction(() => {
      const countRow = this.driver.get(
        "SELECT COUNT(*) AS n FROM workout_exercises WHERE workout_id = ?",
        [workoutId],
      );
      const position = Number(countRow?.n ?? 0);
      this.driver.run(
        "INSERT INTO workout_exercises (id, workout_id, exercise_id, position, rest_seconds, superset_group, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          id, workoutId, input.exerciseId, position,
          input.restSeconds ?? null, input.supersetGroup ?? null, input.notes ?? null,
        ],
      );
      this.markWorkoutDirty(workoutId, "sets_changed");
    });
    const row = this.driver.get("SELECT * FROM workout_exercises WHERE id = ?", [id]);
    if (!row) throw new Error("failed to insert workout exercise");
    return mapWorkoutExercise(row);
  }

  removeExercise(workoutExerciseId: string): void {
    this.driver.transaction(() => {
      const row = this.driver.get("SELECT workout_id FROM workout_exercises WHERE id = ?", [
        workoutExerciseId,
      ]);
      this.driver.run("DELETE FROM workout_exercises WHERE id = ?", [workoutExerciseId]);
      if (row?.workout_id != null) {
        const workoutId = String(row.workout_id);
        this.driver.run(
          "UPDATE workout_exercises SET position = position - 100000 WHERE workout_id = ?",
          [workoutId],
        );
        const all = this.driver
          .all("SELECT id FROM workout_exercises WHERE workout_id = ? ORDER BY position", [workoutId])
          .map((r) => String(r.id));
        all.forEach((weId, position) => {
          this.driver.run("UPDATE workout_exercises SET position = ? WHERE id = ?", [position, weId]);
        });
        this.markWorkoutDirty(workoutId, "sets_changed");
      }
    });
  }

  reorderExercises(workoutId: string, orderedIds: string[]): void {
    this.driver.transaction(() => {
      const known = new Set(
        this.driver
          .all("SELECT id FROM workout_exercises WHERE workout_id = ?", [workoutId])
          .map((r) => String(r.id)),
      );
      for (const id of orderedIds) {
        if (!known.has(id)) throw new Error("workout exercise does not belong to workout: " + id);
      }
      this.driver.run(
        "UPDATE workout_exercises SET position = position - 100000 WHERE workout_id = ?",
        [workoutId],
      );
      orderedIds.forEach((id, position) => {
        this.driver.run("UPDATE workout_exercises SET position = ? WHERE id = ?", [position, id]);
      });
      this.markWorkoutDirty(workoutId, "sets_changed");
    });
  }

  addSet(
    workoutExerciseId: string,
    input: WorkoutSetInput,
    completedAtUtc?: string | null,
  ): WorkoutSet {
    const weRow = this.driver.get(
      "SELECT workout_id FROM workout_exercises WHERE id = ?",
      [workoutExerciseId],
    ) as SetRowRef | undefined;
    if (!weRow) throw new Error("workout exercise not found: " + workoutExerciseId);
    const workoutId = String(weRow.workout_exercise_id);
    const id = this.newId();
    const now = nowUtc();
    // One transaction: the set row + its dirty marker commit atomically.
    this.driver.transaction(() => {
      const countRow = this.driver.get(
        "SELECT COUNT(*) AS n FROM workout_sets WHERE workout_exercise_id = ?",
        [workoutExerciseId],
      );
      const position = Number(countRow?.n ?? 0);
      this.driver.run(
        "INSERT INTO workout_sets (id, workout_exercise_id, position, set_type, weight_kg, reps, " +
          "duration_seconds, distance_meters, rpe, rir, side, completed_at, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id, workoutExerciseId, position, input.setType,
          input.weightKg ?? null, input.reps ?? null, input.durationSeconds ?? null,
          input.distanceMeters ?? null, input.rpe ?? null, input.rir ?? null,
          input.side ?? null, completedAtUtc ?? null, now, now,
        ],
      );
      this.dirty.mark(null, "workout_set", id, "sets_changed");
      this.markWorkoutDirty(workoutId, "sets_changed");
    });
    return this.requireSet(id);
  }

  updateSet(setId: string, input: Partial<WorkoutSetInput>): WorkoutSet {
    const allowed: (keyof WorkoutSetInput)[] = [
      "setType", "weightKg", "reps", "durationSeconds", "distanceMeters", "rpe", "rir", "side",
    ];
    const columns: Record<string, string> = {
      setType: "set_type", weightKg: "weight_kg", reps: "reps",
      durationSeconds: "duration_seconds", distanceMeters: "distance_meters",
      rpe: "rpe", rir: "rir", side: "side",
    };
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const key of allowed) {
      if (input[key] !== undefined) {
        sets.push(columns[key] + " = ?");
        params.push(input[key] as string | number | null);
      }
    }
    if (sets.length === 0) return this.requireSet(setId);
    const weRow = this.driver.get(
      "SELECT workout_id FROM workout_exercises WHERE id = (SELECT workout_exercise_id FROM workout_sets WHERE id = ?)",
      [setId],
    ) as SetRowRef | undefined;
    this.driver.transaction(() => {
      const result = this.driver.run(
        "UPDATE workout_sets SET " + sets.join(", ") + ", updated_at = ? WHERE id = ?",
        [...params, nowUtc(), setId],
      );
      if (result.changes === 0) throw new Error("set not found: " + setId);
      this.dirty.mark(null, "workout_set", setId, "sets_changed");
      if (weRow) this.markWorkoutDirty(String(weRow.workout_exercise_id), "sets_changed");
    });
    return this.requireSet(setId);
  }

  deleteSet(setId: string): void {
    this.driver.transaction(() => {
      const weRow = this.driver.get(
        "SELECT workout_exercise_id FROM workout_sets WHERE id = ?",
        [setId],
      ) as SetRowRef | undefined;
      this.driver.run("DELETE FROM workout_sets WHERE id = ?", [setId]);
      if (weRow) {
        const weId = String(weRow.workout_exercise_id);
        this.driver.run(
          "UPDATE workout_sets SET position = position - 100000 WHERE workout_exercise_id = ?",
          [weId],
        );
        const all = this.driver
          .all("SELECT id FROM workout_sets WHERE workout_exercise_id = ? ORDER BY position", [weId])
          .map((r) => String(r.id));
        all.forEach((sId, position) => {
          this.driver.run("UPDATE workout_sets SET position = ? WHERE id = ?", [position, sId]);
        });
        this.dirty.mark(null, "workout_set", setId, "sets_changed");
        this.markWorkoutDirtyByWorkoutExercise(weId, "sets_changed");
      }
    });
  }

  completeSet(setId: string, completedAtUtc: string): WorkoutSet {
    const weRow = this.driver.get(
      "SELECT workout_id FROM workout_exercises WHERE id = (SELECT workout_exercise_id FROM workout_sets WHERE id = ?)",
      [setId],
    ) as SetRowRef | undefined;
    this.driver.transaction(() => {
      const result = this.driver.run(
        "UPDATE workout_sets SET completed_at = ?, updated_at = ? WHERE id = ?",
        [completedAtUtc, nowUtc(), setId],
      );
      if (result.changes === 0) throw new Error("set not found: " + setId);
      this.dirty.mark(null, "workout_set", setId, "sets_changed");
      if (weRow) this.markWorkoutDirty(String(weRow.workout_exercise_id), "sets_changed");
    });
    return this.requireSet(setId);
  }

  complete(id: string, finishedAtUtc: string): Workout {
    this.driver.transaction(() => {
      const result = this.driver.run(
        "UPDATE workouts SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        [finishedAtUtc, nowUtc(), id],
      );
      if (result.changes === 0) throw new Error("active workout not found: " + id);
      const row = this.driver.get("SELECT profile_id FROM workouts WHERE id = ?", [id]);
      if (row?.profile_id != null) {
        this.markWorkoutDirty(id, "workout_completed");
      }
    });
    return this.requireWorkout(id);
  }

  discard(id: string, discardedAtUtc: string): Workout {
    this.driver.transaction(() => {
      const result = this.driver.run(
        "UPDATE workouts SET status = 'discarded', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        [discardedAtUtc, nowUtc(), id],
      );
      if (result.changes === 0) throw new Error("active workout not found: " + id);
      this.markWorkoutDirty(id, "workout_discarded");
    });
    return this.requireWorkout(id);
  }

  // ------------------------------------------------------------------ //

  private setsFor(workoutExerciseId: string): WorkoutSet[] {
    return this.driver
      .all("SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY position", [workoutExerciseId])
      .map(mapWorkoutSet);
  }

  private markWorkoutDirty(
    workoutId: string,
    reason: "sets_changed" | "workout_saved" | "workout_completed" | "workout_discarded",
  ): void {
    const row = this.driver.get("SELECT profile_id FROM workouts WHERE id = ?", [workoutId]);
    this.dirty.mark(row?.profile_id == null ? null : String(row.profile_id), "workout", workoutId, reason);
  }

  private markWorkoutDirtyByWorkoutExercise(workoutExerciseId: string, reason: "sets_changed"): void {
    const row = this.driver.get("SELECT workout_id FROM workout_exercises WHERE id = ?", [
      workoutExerciseId,
    ]);
    if (row?.workout_id != null) this.markWorkoutDirty(String(row.workout_id), reason);
  }

  private touch(id: string, fields: Record<string, string | number | null>): void {
    const keys = Object.keys(fields);
    const set = keys.map((k) => k + " = ?").join(", ");
    const result = this.driver.run(
      "UPDATE workouts SET " + set + ", updated_at = ? WHERE id = ?",
      [...keys.map((k) => fields[k] as string | number | null), nowUtc(), id],
    );
    if (result.changes === 0) throw new Error("workout not found: " + id);
    this.markWorkoutDirty(id, "sets_changed");
  }

  private requireWorkout(id: string): Workout {
    const row = this.driver.get("SELECT * FROM workouts WHERE id = ?", [id]);
    if (!row) throw new Error("workout not found: " + id);
    return mapWorkout(row);
  }

  private requireSet(id: string): WorkoutSet {
    const row = this.driver.get("SELECT * FROM workout_sets WHERE id = ?", [id]);
    if (!row) throw new Error("set not found: " + id);
    return mapWorkoutSet(row);
  }
}