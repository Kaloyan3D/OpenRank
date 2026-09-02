/**
 * Catalog validation.
 *
 * Two layers:
 * - validateRawExercises: upstream record validation (fail the build loudly on
 *   upstream drift: unknown muscles/equipment/categories, missing fields...).
 * - validateCatalog: assembled-catalog validation (referential integrity,
 *   enums, ordering, alias uniqueness/ambiguity).
 */
import {
  FREE_DB_MUSCLE_TO_ID,
  MUSCLE_IDS,
} from "./taxonomy";
import type {
  CatalogAlias,
  CatalogV1,
  RawExercise,
  ValidationIssue,
} from "./schema";

const KNOWN_EQUIPMENT: ReadonlySet<string | null> = new Set([
  "barbell",
  "body only",
  "bands",
  "cable",
  "dumbbell",
  "e-z curl bar",
  "exercise ball",
  "foam roll",
  "kettlebells",
  "machine",
  "medicine ball",
  "none",
  "other",
  null,
]);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  "strength",
  "stretching",
  "plyometrics",
  "strongman",
  "powerlifting",
  "cardio",
  "olympic weightlifting",
]);

const KNOWN_MECHANIC: ReadonlySet<string | null> = new Set(["compound", "isolation", "isolated", null]);
const KNOWN_FORCE: ReadonlySet<string | null> = new Set(["pull", "push", "static", null]);

const TRACKING_TYPES: ReadonlySet<string> = new Set([
  "weight_reps",
  "bodyweight_reps",
  "bodyweight_weighted",
  "bodyweight_assisted",
  "reps_only",
  "duration",
  "distance_duration",
]);

const CATEGORIES: ReadonlySet<string> = new Set(["strength", "cardio", "mobility", "other"]);
const RANKING_SUPPORTS: ReadonlySet<string> = new Set(["eligible", "provisional", "unsupported"]);
const RANKING_STRATEGIES: ReadonlySet<string> = new Set(["template", "keyword", "curated", "none"]);
const MECHANICS: ReadonlySet<string | null> = new Set(["compound", "isolation", null]);
const FORCES: ReadonlySet<string | null> = new Set(["push", "pull", "static", null]);
const MAJOR_GROUP_IDS: ReadonlySet<string> = new Set([
  "legs", "chest", "back", "shoulders", "arms", "core",
]);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Validate raw upstream records before normalization. */
export function validateRawExercises(raw: readonly RawExercise[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  raw.forEach((e, i) => {
    const where = e && typeof e.id === "string" && e.id !== "" ? e.id : "index " + String(i);
    if (!e || typeof e !== "object") {
      issues.push({ code: "malformed_record", message: "record is not an object", subject: where });
      return;
    }
    for (const field of ["id", "name", "category"] as const) {
      const v = e[field];
      if (v == null || v === "") {
        issues.push({ code: "missing_required_field", message: "missing required field: " + field, subject: where });
      }
    }
    if (typeof e.name === "string" && e.name.trim() === "") {
      issues.push({ code: "missing_required_field", message: "name is blank", subject: where });
    }
    if (!KNOWN_CATEGORIES.has(e.category)) {
      issues.push({ code: "invalid_category", message: "unknown category: " + String(e.category), subject: where });
    }
    if (!KNOWN_MECHANIC.has(e.mechanic)) {
      issues.push({ code: "invalid_mechanic", message: "unknown mechanic: " + String(e.mechanic), subject: where });
    }
    if (!KNOWN_FORCE.has(e.force)) {
      issues.push({ code: "invalid_force", message: "unknown force: " + String(e.force), subject: where });
    }
    if (!KNOWN_EQUIPMENT.has(e.equipment)) {
      issues.push({ code: "invalid_equipment", message: "unknown equipment: " + String(e.equipment), subject: where });
    }
    if (e.id != null) {
      if (seenIds.has(e.id)) {
        issues.push({ code: "duplicate_source_id", message: "duplicate upstream id", subject: e.id });
      }
      seenIds.add(e.id);
    }
    if (typeof e.name === "string") {
      if (seenNames.has(e.name)) {
        issues.push({ code: "duplicate_source_name", message: "duplicate upstream name", subject: e.name });
      }
      seenNames.add(e.name);
    }
    for (const field of ["primaryMuscles", "secondaryMuscles"] as const) {
      const list: unknown = e[field];
      if (!isStringArray(list)) {
        issues.push({ code: "malformed_record", message: field + " must be a string array", subject: where });
        continue;
      }
      for (const m of list) {
        if (!(m in FREE_DB_MUSCLE_TO_ID)) {
          issues.push({
            code: "invalid_muscle_reference",
            message: "unknown upstream muscle: " + m,
            subject: where,
          });
        }
      }
    }
    if (e.instructions != null && !isStringArray(e.instructions)) {
      issues.push({ code: "malformed_record", message: "instructions must be a string array", subject: where });
    }
    if (e.images != null && !isStringArray(e.images)) {
      issues.push({ code: "malformed_record", message: "images must be a string array", subject: where });
    }
  });

  return issues;
}

function sortedBy<T>(list: readonly T[], key: (x: T) => string): boolean {
  for (let i = 1; i < list.length; i++) {
    if (key(list[i - 1] as T) > key(list[i] as T)) return false;
  }
  return true;
}

function tupleKey(a: CatalogAlias): string {
  return a.normalizedAlias + "\u0000" + a.exerciseId + "\u0000" + a.alias;
}

/** Validate the assembled catalog (referential integrity + invariants). */
export function validateCatalog(catalog: CatalogV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (catalog.schemaVersion !== 1) {
    issues.push({ code: "invalid_schema_version", message: "schemaVersion must be 1" });
  }
  if (!sortedBy(catalog.exercises, (e) => e.id)) {
    issues.push({ code: "unsorted_exercises", message: "exercises must be sorted by id" });
  }
  if (!sortedBy(catalog.muscles, (m) => m.id)) {
    issues.push({ code: "unsorted_muscles", message: "muscles must be sorted by id" });
  }

  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const seenSourceIds = new Set<string>();
  const exerciseIds = new Set<string>();

  for (const ex of catalog.exercises) {
    exerciseIds.add(ex.id);
    if (ex.id === "" || ex.name.trim() === "" || ex.slug === "" || ex.sourceId === "") {
      issues.push({ code: "missing_required_field", message: "exercise missing id/name/slug/sourceId", subject: ex.id });
    }
    if (seenIds.has(ex.id)) {
      issues.push({ code: "duplicate_canonical_id", message: "duplicate exercise id", subject: ex.id });
    }
    seenIds.add(ex.id);
    if (seenSlugs.has(ex.slug)) {
      issues.push({ code: "duplicate_slug", message: "duplicate slug", subject: ex.slug });
    }
    seenSlugs.add(ex.slug);
    const sourceKey = ex.source + ":" + ex.sourceId;
    if (seenSourceIds.has(sourceKey)) {
      issues.push({ code: "duplicate_source_id", message: "duplicate sourceId within source", subject: sourceKey });
    }
    seenSourceIds.add(sourceKey);

    if (!CATEGORIES.has(ex.category)) {
      issues.push({ code: "invalid_category", message: "invalid category: " + ex.category, subject: ex.id });
    }
    if (!MECHANICS.has(ex.mechanic)) {
      issues.push({ code: "invalid_mechanic", message: "invalid mechanic", subject: ex.id });
    }
    if (!FORCES.has(ex.force)) {
      issues.push({ code: "invalid_force", message: "invalid force", subject: ex.id });
    }
    if (!TRACKING_TYPES.has(ex.trackingType)) {
      issues.push({
        code: "invalid_tracking_type",
        message: "invalid tracking type: " + String(ex.trackingType),
        subject: ex.id,
      });
    }
    if (typeof ex.equipment !== "string" && ex.equipment !== null) {
      issues.push({ code: "malformed_record", message: "equipment must be string or null", subject: ex.id });
    }
    if (!isStringArray(ex.instructions)) {
      issues.push({ code: "malformed_record", message: "instructions must be a string array", subject: ex.id });
    }
    if (!isStringArray(ex.images)) {
      issues.push({ code: "malformed_record", message: "images must be a string array", subject: ex.id });
    }
    for (const field of ["primaryMuscles", "secondaryMuscles"] as const) {
      for (const m of ex[field]) {
        if (!MUSCLE_IDS.has(m)) {
          issues.push({ code: "invalid_muscle_reference", message: "unknown muscle id: " + m, subject: ex.id });
        }
      }
    }
    for (const m of ex.primaryMuscles) {
      if (ex.secondaryMuscles.includes(m)) {
        issues.push({ code: "muscle_overlap", message: "muscle both primary and secondary: " + m, subject: ex.id });
      }
    }
    if (ex.isCustom !== false) {
      issues.push({ code: "malformed_record", message: "catalog exercises cannot be custom", subject: ex.id });
    }
    if (ex.ranking == null) {
      issues.push({ code: "missing_required_field", message: "exercise missing ranking metadata", subject: ex.id });
    } else {
      const r = ex.ranking;
      if (r.group !== null && !MAJOR_GROUP_IDS.has(r.group)) {
        issues.push({ code: "invalid_ranking_group", message: "invalid anatomical ranking group", subject: ex.id });
      }
      if (!RANKING_SUPPORTS.has(r.support)) {
        issues.push({ code: "invalid_ranking_support", message: "invalid ranking support: " + String(r.support), subject: ex.id });
      }
      if (!RANKING_STRATEGIES.has(r.strategy)) {
        issues.push({ code: "invalid_ranking_strategy", message: "invalid ranking strategy: " + String(r.strategy), subject: ex.id });
      }
      if (r.engineGroup !== null && !MAJOR_GROUP_IDS.has(r.engineGroup)) {
        issues.push({ code: "invalid_ranking_group", message: "invalid engine ranking group", subject: ex.id });
      }
      if (r.support === "unsupported") {
        if (r.engineGroup !== null) {
          issues.push({ code: "inconsistent_ranking_metadata", message: "unsupported exercise must not carry an engine group", subject: ex.id });
        }
        if (r.strategy !== "none") {
          issues.push({ code: "inconsistent_ranking_metadata", message: "unsupported exercise must use strategy 'none'", subject: ex.id });
        }
        if (r.reason == null || r.reason.trim() === "") {
          issues.push({ code: "missing_ranking_reason", message: "unsupported exercise requires a reason", subject: ex.id });
        }
      } else {
        if (r.engineGroup === null) {
          issues.push({ code: "inconsistent_ranking_metadata", message: "participating exercise requires an engine group", subject: ex.id });
        }
        if (r.strategy === "none") {
          issues.push({ code: "inconsistent_ranking_metadata", message: "participating exercise requires a mapping strategy", subject: ex.id });
        }
        if (r.support === "eligible" && r.reason != null && r.reason.trim() !== "") {
          issues.push({ code: "inconsistent_ranking_metadata", message: "eligible exercise must not carry a reason", subject: ex.id });
        }
        if (r.support === "provisional" && (r.reason == null || r.reason.trim() === "")) {
          issues.push({ code: "missing_ranking_reason", message: "provisional exercise requires a reason", subject: ex.id });
        }
      }
    }
  }

  // Alias integrity.
  const aliasToExercise = new Map<string, string>();
  const seenAliasPairs = new Set<string>();
  if (!sortedBy(catalog.aliases, tupleKey)) {
    issues.push({ code: "unsorted_aliases", message: "aliases must be sorted by (normalizedAlias, exerciseId, alias)" });
  }
  for (const a of catalog.aliases) {
    checkAliasShape(a, issues);
    if (!exerciseIds.has(a.exerciseId)) {
      issues.push({ code: "dangling_alias", message: "alias references unknown exercise", subject: a.normalizedAlias });
    }
    const pair = a.exerciseId + "\u0000" + a.normalizedAlias;
    if (seenAliasPairs.has(pair)) {
      issues.push({ code: "duplicate_alias", message: "duplicate alias for exercise", subject: a.normalizedAlias });
    }
    seenAliasPairs.add(pair);
    const owner = aliasToExercise.get(a.normalizedAlias);
    if (owner === undefined) {
      aliasToExercise.set(a.normalizedAlias, a.exerciseId);
    } else if (owner !== a.exerciseId) {
      issues.push({
        code: "ambiguous_alias",
        message: "normalized alias maps to multiple exercises",
        subject: a.normalizedAlias,
      });
    }
  }

  // Muscle catalog integrity.
  const seenMuscleIds = new Set<string>();
  for (const m of catalog.muscles) {
    if (seenMuscleIds.has(m.id)) {
      issues.push({ code: "duplicate_muscle", message: "duplicate muscle id", subject: m.id });
    }
    seenMuscleIds.add(m.id);
    if (!MAJOR_GROUP_IDS.has(m.majorGroup)) {
      issues.push({ code: "invalid_major_group", message: "invalid major group: " + m.majorGroup, subject: m.id });
    }
  }

  return issues;
}

function checkAliasShape(a: CatalogAlias, issues: ValidationIssue[]): void {
  if (a.exerciseId === "" || a.alias.trim() === "" || a.normalizedAlias.trim() === "") {
    issues.push({ code: "malformed_record", message: "alias missing exerciseId/alias/normalizedAlias", subject: a.alias });
  }
  if (a.locale.trim() === "") {
    issues.push({ code: "malformed_record", message: "alias missing locale", subject: a.alias });
  }
}