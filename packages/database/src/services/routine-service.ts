/**
 * Routine service (Phase 4) - routine builder application layer.
 *
 * Wraps RoutineRepository with ownership checks and target-set handling.
 * Starting a workout from a routine happens in WorkoutService (snapshot
 * semantics live there); editing a routine here never touches started or
 * finished workouts - the workout holds its own snapshot.
 */

import type {
  ExerciseRepository,
  ProfileRepository,
  Routine,
  RoutineDetail,
  RoutineExercise,
  RoutineExerciseAddInput,
  RoutineRepository,
  RoutineSetTargetInput,
} from "@openrank/domain";

export interface RoutineServiceRepos {
  profile: ProfileRepository;
  exercise: ExerciseRepository;
  routine: RoutineRepository;
}

export interface RoutineExerciseInput {
  exerciseId: string;
  restSeconds?: number | null;
  supersetGroup?: string | null;
  notes?: string | null;
  targets?: RoutineSetTargetInput[];
}

export class RoutineService {
  constructor(private readonly repos: RoutineServiceRepos) {}

  create(profileId: string, name: string): Routine {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("routine name must not be empty");
    return this.repos.routine.create({ profileId, name: trimmed });
  }

  /** Active and archived routines, separated for the list screen. */
  list(profileId: string): { active: Routine[]; archived: Routine[] } {
    const all = this.repos.routine.list(profileId, true);
    return {
      active: all.filter((r) => r.archivedAt == null),
      archived: all.filter((r) => r.archivedAt != null),
    };
  }

  get(routineId: string): RoutineDetail {
    const detail = this.repos.routine.getById(routineId);
    if (!detail) throw new Error("routine not found: " + routineId);
    return detail;
  }

  rename(routineId: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("routine name must not be empty");
    this.repos.routine.rename(routineId, trimmed);
  }

  setNotes(routineId: string, notes: string | null): void {
    this.repos.routine.setNotes(routineId, notes);
  }

  archive(routineId: string): void {
    this.repos.routine.archive(routineId, new Date().toISOString());
  }

  unarchive(routineId: string): void {
    this.repos.routine.unarchive(routineId);
  }

  /** Delete the routine (workouts keep running via ON DELETE SET NULL). */
  delete(routineId: string): void {
    this.repos.routine.delete(routineId);
  }

  addExercise(routineId: string, input: RoutineExerciseInput): RoutineExercise {
    this.assertExerciseExists(input.exerciseId);
    const added = this.repos.routine.addExercise(routineId, {
      exerciseId: input.exerciseId,
      restSeconds: input.restSeconds ?? null,
      supersetGroup: input.supersetGroup ?? null,
      notes: input.notes ?? null,
    } satisfies RoutineExerciseAddInput);
    if (input.targets && input.targets.length > 0) {
      this.repos.routine.setTargets(added.id, input.targets);
    }
    return added;
  }

  removeExercise(routineExerciseId: string): void {
    this.repos.routine.removeExercise(routineExerciseId);
  }

  reorderExercises(routineId: string, orderedRoutineExerciseIds: string[]): void {
    this.repos.routine.reorderExercises(routineId, orderedRoutineExerciseIds);
  }

  setRestSeconds(routineExerciseId: string, restSeconds: number | null): void {
    if (restSeconds != null && (!(restSeconds > 0) || !Number.isFinite(restSeconds))) {
      throw new Error("rest seconds must be a positive number");
    }
    this.repos.routine.setRestSeconds(
      routineExerciseId,
      restSeconds == null ? null : Math.round(restSeconds),
    );
  }

  setSupersetGroup(routineExerciseId: string, group: string | null): void {
    this.repos.routine.setSupersetGroup(routineExerciseId, group);
  }

  /** Replace all target sets of one routine exercise (transactional). */
  setTargets(routineExerciseId: string, targets: RoutineSetTargetInput[]): void {
    this.repos.routine.setTargets(routineExerciseId, targets);
  }

  private assertExerciseExists(exerciseId: string): void {
    if (!this.repos.exercise.findById(exerciseId)) {
      throw new Error("exercise not found: " + exerciseId);
    }
  }
}