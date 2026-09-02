/** Routine repository (SQLite implementation - Phase 4 builder consumes). */

import type {
  Routine,
  RoutineCreateInput,
  RoutineDetail,
  RoutineExercise,
  RoutineExerciseAddInput,
  RoutineRepository,
  RoutineSetTarget,
  RoutineSetTargetInput,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { mapRoutine, mapRoutineExercise, mapRoutineSetTarget, nowUtc } from "../rows";

export class SqliteRoutineRepository implements RoutineRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly newId: () => string,
  ) {}

  create(input: RoutineCreateInput): Routine {
    const id = this.newId();
    const now = nowUtc();
    this.driver.run(
      "INSERT INTO routines (id, profile_id, name, notes, created_at, updated_at, archived_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, NULL)",
      [id, input.profileId, input.name, input.notes ?? null, now, now],
    );
    return this.requireRoutine(id);
  }

  getById(id: string): RoutineDetail | null {
    const routineRow = this.driver.get("SELECT * FROM routines WHERE id = ?", [id]);
    if (!routineRow) return null;
    const exercises = this.driver
      .all("SELECT * FROM routine_exercises WHERE routine_id = ? ORDER BY position", [id])
      .map(mapRoutineExercise)
      .map((re) => ({
        ...re,
        targets: this.driver
          .all("SELECT * FROM routine_set_targets WHERE routine_exercise_id = ? ORDER BY position", [re.id])
          .map(mapRoutineSetTarget),
      }));
    return { routine: mapRoutine(routineRow), exercises };
  }

  list(profileId: string, includeArchived = false): Routine[] {
    const where = includeArchived ? "WHERE profile_id = ?" : "WHERE profile_id = ? AND archived_at IS NULL";
    return this.driver
      .all("SELECT * FROM routines " + where + " ORDER BY created_at, id", [profileId])
      .map(mapRoutine);
  }

  rename(id: string, name: string): void {
    this.touch(id, { name });
  }

  setNotes(id: string, notes: string | null): void {
    this.touch(id, { notes });
  }

  archive(id: string, archivedAtUtc: string): void {
    this.touch(id, { archived_at: archivedAtUtc });
  }

  unarchive(id: string): void {
    this.touch(id, { archived_at: null });
  }

  delete(id: string): void {
    // Cascades to routine_exercises + their targets (schema policy).
    this.driver.run("DELETE FROM routines WHERE id = ?", [id]);
  }

  addExercise(routineId: string, input: RoutineExerciseAddInput): RoutineExercise {
    const id = this.newId();
    this.driver.transaction(() => {
      const countRow = this.driver.get(
        "SELECT COUNT(*) AS n FROM routine_exercises WHERE routine_id = ?",
        [routineId],
      );
      const position = Number(countRow?.n ?? 0);
      this.driver.run(
        "INSERT INTO routine_exercises (id, routine_id, exercise_id, position, rest_seconds, superset_group, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          id, routineId, input.exerciseId, position,
          input.restSeconds ?? null, input.supersetGroup ?? null, input.notes ?? null,
        ],
      );
    });
    return this.requireRoutineExercise(id);
  }

  removeExercise(routineExerciseId: string): void {
    this.driver.transaction(() => {
      const row = this.driver.get("SELECT routine_id FROM routine_exercises WHERE id = ?", [
        routineExerciseId,
      ]);
      this.driver.run("DELETE FROM routine_exercises WHERE id = ?", [routineExerciseId]);
      if (row?.routine_id != null) this.renumber(String(row.routine_id));
    });
  }

  reorderExercises(routineId: string, orderedIds: string[]): void {
    this.driver.transaction(() => {
      const known = new Set(
        this.driver
          .all("SELECT id FROM routine_exercises WHERE routine_id = ?", [routineId])
          .map((r) => String(r.id)),
      );
      for (const id of orderedIds) {
        if (!known.has(id)) throw new Error("routine exercise does not belong to routine: " + id);
      }
      // Two-phase update: shift everything far negative first so the final
      // assignment can never collide with UNIQUE(routine_id, position).
      this.driver.run(
        "UPDATE routine_exercises SET position = position - 100000 WHERE routine_id = ?",
        [routineId],
      );
      orderedIds.forEach((id, position) => {
        this.driver.run("UPDATE routine_exercises SET position = ? WHERE id = ?", [position, id]);
      });
      // Enforce dense positions for rows not covered by orderedIds.
      const all = this.driver
        .all("SELECT id FROM routine_exercises WHERE routine_id = ? ORDER BY position", [routineId])
        .map((r) => String(r.id));
      all.forEach((id, position) => {
        this.driver.run("UPDATE routine_exercises SET position = ? WHERE id = ?", [position, id]);
      });
    });
  }

  setRestSeconds(routineExerciseId: string, restSeconds: number | null): void {
    this.driver.run("UPDATE routine_exercises SET rest_seconds = ? WHERE id = ?", [
      restSeconds, routineExerciseId,
    ]);
  }

  setSupersetGroup(routineExerciseId: string, supersetGroup: string | null): void {
    this.driver.run("UPDATE routine_exercises SET superset_group = ? WHERE id = ?", [
      supersetGroup, routineExerciseId,
    ]);
  }

  setTargets(routineExerciseId: string, targets: RoutineSetTargetInput[]): RoutineSetTarget[] {
    const ids: string[] = [];
    this.driver.transaction(() => {
      this.driver.run("DELETE FROM routine_set_targets WHERE routine_exercise_id = ?", [
        routineExerciseId,
      ]);
      targets.forEach((t, position) => {
        const id = this.newId();
        ids.push(id);
        this.driver.run(
          "INSERT INTO routine_set_targets (id, routine_exercise_id, position, set_type, target_reps_min, " +
            "target_reps_max, target_weight_kg, target_rpe, target_rir) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            id, routineExerciseId, position, t.setType,
            t.targetRepsMin ?? null, t.targetRepsMax ?? null, t.targetWeightKg ?? null,
            t.targetRpe ?? null, t.targetRir ?? null,
          ],
        );
      });
    });
    return ids.map((id) => {
      const row = this.driver.get("SELECT * FROM routine_set_targets WHERE id = ?", [id]);
      if (!row) throw new Error("failed to insert routine set target");
      return mapRoutineSetTarget(row);
    });
  }

  /** Dense renumber after removals (keeps UNIQUE(routine_id, position) sane). */
  private renumber(routineId: string): void {
    // Shift to a negative range first, then assign dense positions.
    this.driver.run(
      "UPDATE routine_exercises SET position = position - 100000 WHERE routine_id = ?",
      [routineId],
    );
    const all = this.driver
      .all("SELECT id FROM routine_exercises WHERE routine_id = ? ORDER BY position", [routineId])
      .map((r) => String(r.id));
    all.forEach((id, position) => {
      this.driver.run("UPDATE routine_exercises SET position = ? WHERE id = ?", [position, id]);
    });
  }

  private touch(id: string, fields: Record<string, string | number | null>): void {
    const keys = Object.keys(fields);
    const set = keys.map((k) => k + " = ?").join(", ");
    const result = this.driver.run(
      "UPDATE routines SET " + set + ", updated_at = ? WHERE id = ?",
      [...keys.map((k) => fields[k] as string | number | null), nowUtc(), id],
    );
    if (result.changes === 0) throw new Error("routine not found: " + id);
  }

  private requireRoutine(id: string): Routine {
    const row = this.driver.get("SELECT * FROM routines WHERE id = ?", [id]);
    if (!row) throw new Error("failed to insert routine");
    return mapRoutine(row);
  }

  private requireRoutineExercise(id: string): RoutineExercise {
    const row = this.driver.get("SELECT * FROM routine_exercises WHERE id = ?", [id]);
    if (!row) throw new Error("failed to insert routine exercise");
    return mapRoutineExercise(row);
  }
}