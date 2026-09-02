/**
 * Canonical exercise domain model.
 *
 * Pure types only - no persistence, no UI, no ranking math. The database layer
 * (Phase 3) maps these to SQLite rows; the ranking engine (Phase 1) works on
 * its own engine-level session types.
 */

export type ExerciseCategory = "strength" | "cardio" | "mobility" | "other";

export type ExerciseMechanic = "compound" | "isolation" | null;

export type ExerciseForce = "push" | "pull" | "static" | null;

/**
 * How a set is logged for this exercise. Mirrors the Hevy template types plus
 * OpenRank's normalized set. Stored in `exercises.tracking_type`.
 */
export type TrackingType =
  | "weight_reps"
  | "bodyweight_reps"
  | "bodyweight_weighted"
  | "bodyweight_assisted"
  | "reps_only"
  | "duration"
  | "distance_duration";

export interface Exercise {
  /** Globally unique id (UUIDv7-style, locally owned - future cloud sync safe). */
  id: string;
  /** URL-safe stable identifier derived from the name. */
  slug: string;
  name: string;
  category: ExerciseCategory;
  mechanic: ExerciseMechanic;
  force: ExerciseForce;
  /** Canonical equipment tag, e.g. "barbell", "dumbbell", "machine". */
  equipment: string | null;
  trackingType: TrackingType;
  isCustom: boolean;
  /** Dataset origin, e.g. "free-exercise-db", "hevy-templates", "user". */
  source: string;
  sourceId: string | null;
  /** Whether (and how confidently) this exercise participates in ranking. */
  rankingEligibility: RankingEligibility;
  /** Mapping strategy toward ranking-core. */
  rankingStrategy: RankingStrategy;
  /** Engine's authoritative group when participating, else null. */
  rankingGroup: MajorGroup | null;
  /** Why an unsupported/provisional exercise is not (confidently) ranked. */
  rankingReason: string | null;
}

export type MuscleRole = "primary" | "secondary";

/** The six major rank groups (aligned with ranking-core GROUPS keys). */
export type MajorGroup = "legs" | "chest" | "back" | "shoulders" | "arms" | "core";

/**
 * Ranking-support semantics (Phase 3): whether an exercise participates in
 * ranking and how confident its mapping into ranking-core is. The frozen
 * engine remains the sole ranking authority.
 */
export type RankingEligibility = "eligible" | "provisional" | "unsupported";

/** How an exercise maps into ranking-core. */
export type RankingStrategy = "template" | "keyword" | "curated" | "none";

export interface Muscle {
  id: string;
  name: string;
  /** One of the six major rank groups: legs, chest, back, shoulders, arms, core. */
  majorGroup: string;
}

export interface ExerciseMuscle {
  exerciseId: string;
  muscleId: string;
  role: MuscleRole;
}