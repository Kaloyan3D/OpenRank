/**
 * Derived-state models (Phase 5): personal records, rank snapshots, rank
 * events. These rows are REBUILDABLE CACHES over canonical workout data -
 * they must never become irreplaceable source data and never feed back into
 * canonical tables.
 *
 * Provenance columns (source_set_id / source_workout_id) are plain TEXT
 * references, deliberately WITHOUT foreign keys: derived rows are owned by
 * the DerivedDataWorker (rebuildable from canonical data), so a canonical
 * deletion must not silently cascade into half-updated projections - the
 * rebuild is what restores consistency.
 */

/** Supported personal-record kinds (Phase 5). */
export type PersonalRecordType =
  | "max_weight"
  | "max_e1rm"
  | "max_set_volume"
  | "max_reps_at_weight";

/**
 * Weight qualifier identity for reps-at-weight records.
 * Normalization: canonical kg rounded to 4 decimal places, rendered as the
 * shortest deterministic JS number string (never raw float formatting of
 * intermediate arithmetic). External weight null (pure bodyweight) -> "w=0".
 */
export type PrQualifierKey = string;

export interface PersonalRecord {
  id: string;
  profileId: string;
  exerciseId: string;
  recordType: PersonalRecordType;
  /** "" for non-weight-keyed record types; "w=<kg>" for max_reps_at_weight. */
  qualifierKey: PrQualifierKey;
  /** Canonical units: kg for weight/e1RM, kg·reps for set volume, count for reps. */
  value: number;
  /** Reps of the record-setting set (display provenance; null when n/a). */
  sourceReps: number | null;
  sourceSetId: string;
  sourceWorkoutId: string;
  achievedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalRecordEvent {
  id: string;
  profileId: string;
  exerciseId: string;
  recordType: PersonalRecordType;
  qualifierKey: PrQualifierKey;
  /** Previous best (null = first record of this kind). */
  previousValue: number | null;
  value: number;
  sourceSetId: string;
  sourceWorkoutId: string;
  achievedAt: string;
  createdAt: string;
}

export type RankScopeType = "exercise" | "muscle";

export interface RankSnapshot {
  id: string;
  profileId: string;
  scopeType: RankScopeType;
  /** exercise_id for exercise scope; engine group key for muscle scope. */
  scopeKey: string;
  tierIndex: number;
  tierName: string;
  /** "IV" | "III" | "II" | "I"; NULL at Mythic (top tier has no next threshold). */
  division: string | null;
  /** Reference-equivalent strength / bodyweight ratio (engine eqRatio). */
  score: number;
  /** 0..1 toward the next tier; NULL at Mythic. */
  progress: number | null;
  rankingVersion: string;
  projectionVersion: string;
  calculatedAt: string;
  /** The workout whose completion produced this state. */
  sourceWorkoutId: string;
  detailsJson: string;
}

export type RankDirection = "up" | "down";

export interface RankEvent {
  id: string;
  profileId: string;
  scopeType: RankScopeType;
  scopeKey: string;
  fromTierIndex: number | null;
  fromTier: string | null;
  fromDivision: string | null;
  toTierIndex: number;
  toTier: string;
  toDivision: string | null;
  direction: RankDirection;
  score: number;
  rankingVersion: string;
  projectionVersion: string;
  sourceWorkoutId: string;
  createdAt: string;
}
