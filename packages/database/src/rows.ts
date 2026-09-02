/** Row -> domain-type mappers shared by the repositories. */

import { asStr, b, toBool } from "./driver";
import type { SqlRow } from "./driver";
import type {
  BodyweightEntry,
  Exercise,
  MajorGroup,
  Muscle,
  Profile,
  RankingEligibility,
  RankingStrategy,
  Routine,
  RoutineExercise,
  RoutineSetTarget,
  SetTargetSnapshot,
  SetType,
  TrackingType,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutStatus,
} from "@openrank/domain";

export function nowUtc(): string {
  return new Date().toISOString();
}

export function mapProfile(row: SqlRow): Profile {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    strengthStandard: String(row.strength_standard) as Profile["strengthStandard"],
    unitSystem: String(row.unit_system) as Profile["unitSystem"],
    onboardingCompleted: toBool(row.onboarding_completed),
  };
}

export function mapBodyweight(row: SqlRow): BodyweightEntry {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    measuredAt: String(row.measured_at),
    weightKg: Number(row.weight_kg),
    source: String(row.source),
    note: asStr(row.note),
  };
}

export function mapExercise(row: SqlRow): Exercise {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    category: String(row.category) as Exercise["category"],
    mechanic: asStr(row.mechanic) as Exercise["mechanic"],
    force: asStr(row.force) as Exercise["force"],
    equipment: asStr(row.equipment),
    trackingType: String(row.tracking_type) as TrackingType,
    isCustom: toBool(row.is_custom),
    source: String(row.source),
    sourceId: asStr(row.source_id),
    rankingEligibility: String(row.ranking_eligibility) as RankingEligibility,
    rankingStrategy: String(row.ranking_strategy) as RankingStrategy,
    rankingGroup: asStr(row.ranking_group) as MajorGroup | null,
    rankingReason: asStr(row.ranking_reason),
  };
}

export function mapMuscle(row: SqlRow): Muscle {
  return {
    id: String(row.id),
    name: String(row.name),
    majorGroup: String(row.major_group),
  };
}

export function mapRoutine(row: SqlRow): Routine {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    name: String(row.name),
    notes: asStr(row.notes),
    archivedAt: asStr(row.archived_at),
  };
}

export function mapRoutineExercise(row: SqlRow): RoutineExercise {
  return {
    id: String(row.id),
    routineId: String(row.routine_id),
    exerciseId: String(row.exercise_id),
    position: Number(row.position),
    restSeconds: row.rest_seconds == null ? null : Number(row.rest_seconds),
    supersetGroup: asStr(row.superset_group),
    notes: asStr(row.notes),
  };
}

export function mapRoutineSetTarget(row: SqlRow): RoutineSetTarget {
  return {
    id: String(row.id),
    routineExerciseId: String(row.routine_exercise_id),
    position: Number(row.position),
    setType: String(row.set_type) as SetType,
    targetRepsMin: row.target_reps_min == null ? null : Number(row.target_reps_min),
    targetRepsMax: row.target_reps_max == null ? null : Number(row.target_reps_max),
    targetWeightKg: row.target_weight_kg == null ? null : Number(row.target_weight_kg),
    targetRpe: row.target_rpe == null ? null : Number(row.target_rpe),
    targetRir: row.target_rir == null ? null : Number(row.target_rir),
  };
}

export function mapWorkout(row: SqlRow): Workout {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    routineId: asStr(row.routine_id),
    title: asStr(row.title),
    status: String(row.status) as WorkoutStatus,
    startedAt: String(row.started_at),
    finishedAt: asStr(row.finished_at),
    startLocalDate: String(row.start_local_date),
    logicalTrainingDate: String(row.logical_training_date),
    startTimezoneOffsetMinutes: Number(row.start_timezone_offset_minutes),
    notes: asStr(row.notes),
  };
}

export function mapWorkoutExercise(row: SqlRow): WorkoutExercise {
  return {
    id: String(row.id),
    workoutId: String(row.workout_id),
    exerciseId: String(row.exercise_id),
    position: Number(row.position),
    restSeconds: row.rest_seconds == null ? null : Number(row.rest_seconds),
    supersetGroup: asStr(row.superset_group),
    notes: asStr(row.notes),
    targetSets: parseTargetsJson(asStr(row.targets_json)),
  };
}

/** Parse the target-set snapshot JSON (null when absent or malformed). */
function parseTargetsJson(json: string | null): SetTargetSnapshot[] | null {
  if (json == null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((t) => {
      const o = t as Record<string, unknown>;
      return {
        setType: String(o.setType) as SetTargetSnapshot["setType"],
        targetRepsMin: o.targetRepsMin == null ? null : Number(o.targetRepsMin),
        targetRepsMax: o.targetRepsMax == null ? null : Number(o.targetRepsMax),
        targetWeightKg: o.targetWeightKg == null ? null : Number(o.targetWeightKg),
        targetRpe: o.targetRpe == null ? null : Number(o.targetRpe),
        targetRir: o.targetRir == null ? null : Number(o.targetRir),
      };
    });
  } catch {
    return null;
  }
}

export function mapWorkoutSet(row: SqlRow): WorkoutSet {
  return {
    id: String(row.id),
    workoutExerciseId: String(row.workout_exercise_id),
    position: Number(row.position),
    setType: String(row.set_type) as SetType,
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    reps: row.reps == null ? null : Number(row.reps),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    distanceMeters: row.distance_meters == null ? null : Number(row.distance_meters),
    rpe: row.rpe == null ? null : Number(row.rpe),
    rir: row.rir == null ? null : Number(row.rir),
    side: asStr(row.side) as WorkoutSet["side"],
    completedAt: asStr(row.completed_at),
  };
}

export { b };