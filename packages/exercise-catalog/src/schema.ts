/**
 * Catalog schema (catalog.v1.json).
 *
 * The catalog is a deterministic, offline bundle derived from the pinned
 * upstream dataset (datasets/sources.lock.json). Two builds from the same
 * pinned snapshot MUST be byte-identical - therefore the schema contains no
 * timestamps or other volatile metadata.
 */

export type ExerciseCategory = "strength" | "cardio" | "mobility" | "other";

export type ExerciseMechanic = "compound" | "isolation" | null;

export type ExerciseForce = "push" | "pull" | "static" | null;

export type TrackingType =
  | "weight_reps"
  | "bodyweight_reps"
  | "bodyweight_weighted"
  | "bodyweight_assisted"
  | "reps_only"
  | "duration"
  | "distance_duration";

/** The six major rank groups (shared with ranking-core's group keys). */
export type MajorGroup = "legs" | "chest" | "back" | "shoulders" | "arms" | "core";

export interface CatalogMuscle {
  /** Canonical muscle id - aligns with ranking-core's primary-muscle keys. */
  id: string;
  /** Display name. */
  name: string;
  majorGroup: MajorGroup;
}

/** A canonical exercise in the bundled catalog. */
export interface CatalogExercise {
  /** Stable canonical id, e.g. "fdb:barbell-bench-press". */
  id: string;
  slug: string;
  name: string;
  category: ExerciseCategory;
  mechanic: ExerciseMechanic;
  force: ExerciseForce;
  /** Normalized equipment tag, null for bodyweight/no equipment. */
  equipment: string | null;
  trackingType: TrackingType;
  isCustom: boolean;
  /** Dataset origin, always "free-exercise-db" in catalog.v1. */
  source: string;
  /** Upstream exercise id (stable in the upstream dataset). */
  sourceId: string;
  /** Canonical muscle ids (normalized taxonomy), sorted. */
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** Instruction steps from upstream (public domain text). */
  instructions: string[];
  /** Upstream image paths (manifest only - media is not bundled). */
  images: string[];
  /** Ranking integration hints (mapping infra toward ranking-core). */
  ranking: {
    /** Major group implied by the primary muscles (null if unmapped). */
    group: MajorGroup | null;
    /** Whether this exercise is considered rank-eligible. */
    eligible: boolean;
  };
}

export type AliasKind =
  /** The exercise's canonical name itself. */
  | "name"
  /** A generated name variant (equipment/qualifier stripped). */
  | "variant"
  /** An alias imported from an external source (e.g. Hevy templates). */
  | "import-source";

export interface CatalogAlias {
  exerciseId: string;
  /** Alias as written (display form). */
  alias: string;
  /** Deburred, lowercased, whitespace-normalized lookup key. */
  normalizedAlias: string;
  /** ISO-639-ish locale tag of the alias text. */
  locale: string;
  /** Where the alias came from: "free-exercise-db" | "hevy-templates". */
  source: string;
  /** Source-specific identifier (e.g. Hevy exercise_template_id). */
  sourceId?: string | undefined;
  /** How this alias was produced. */
  kind: AliasKind;
}

export interface CatalogSourceInfo {
  name: string;
  repositoryUrl: string;
  commit: string;
  license: string;
  datasetSha256: string;
}

export interface CatalogV1 {
  schemaVersion: 1;
  /** Compatible ranking engine version the mapping targets. */
  rankingCompatibility: string;
  source: CatalogSourceInfo;
  /** Alias provenance beyond the primary dataset. */
  aliasSources: CatalogSourceInfo[];
  muscles: CatalogMuscle[];
  /** Sorted by id. */
  exercises: CatalogExercise[];
  /** Sorted by (normalizedAlias, exerciseId, alias). */
  aliases: CatalogAlias[];
}

/** A raw upstream record (free-exercise-db dist/exercises.json). */
export interface RawExercise {
  id: string;
  name: string;
  force: string | null;
  level?: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

/** A Hevy exercise template (from the vendored ranking-engine catalog). */
export interface HevyTemplate {
  id?: string;
  title?: string;
  type?: string;
  primary?: string;
  equipment?: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  /** Offending identifier when applicable (id, slug, alias...). */
  subject?: string | undefined;
}

export interface BuildStats {
  exercises: number;
  byCategory: Record<string, number>;
  byEquipment: Record<string, number>;
  byMechanic: Record<string, number>;
  byTrackingType: Record<string, number>;
  rankEligible: number;
  rankEligibleByGroup: Record<string, number>;
  primaryMuscleUsage: Record<string, number>;
  missingInstructions: number;
  missingImages: number;
  aliases: { total: number; bySource: Record<string, number>; byKind: Record<string, number> };
  aliasAmbiguitiesDropped: number;
  hevyTemplatesMapped: number;
  hevyTemplatesUnmapped: number;
  excluded: { exerciseId: string; reason: string }[];
}
