/**
 * Routine domain models (types only - Phase 3 persistence, Phase 4 UI).
 */

import type { SetType } from "./workout";

export interface Routine {
  id: string;
  profileId: string;
  name: string;
  notes: string | null;
  /** Null while the routine is active; ISO timestamp once archived. */
  archivedAt: string | null;
}

export interface RoutineExercise {
  id: string;
  routineId: string;
  exerciseId: string;
  /** 0-based, dense ordering within the routine. */
  position: number;
  restSeconds: number | null;
  supersetGroup: string | null;
  notes: string | null;
}

export interface RoutineSetTarget {
  id: string;
  routineExerciseId: string;
  position: number;
  setType: SetType;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
  targetRir: number | null;
}

/** A routine with its ordered exercises and their target sets. */
export interface RoutineDetail {
  routine: Routine;
  exercises: (RoutineExercise & { targets: RoutineSetTarget[] })[];
}
