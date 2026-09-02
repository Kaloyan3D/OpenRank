/**
 * Offline exercise search + filtering over the bundled catalog.
 * Pure functions - the mobile app calls these directly, no database needed
 * until Phase 3 introduces persistence.
 */
import type { CatalogAlias, CatalogExercise, CatalogV1, TrackingType } from "./schema";
import type { MajorGroup } from "./schema";
import { normalizeAlias } from "./normalize";

export interface SearchFilters {
  /** Free-text query (matched against aliases and names, deburred). */
  query?: string | undefined;
  /** Filter by major group. */
  majorGroup?: MajorGroup | null | undefined;
  /** Filter by canonical equipment tag; null filters bodyweight-only. */
  equipment?: string | null | undefined;
  /** Filter by tracking type. */
  trackingType?: TrackingType | null | undefined;
  /** Only exercises that participate in ranking (eligible + provisional). */
  rankSupportedOnly?: boolean | undefined;
}

export interface ExerciseSearchResult {
  exercise: CatalogExercise;
  /** How well the exercise matched: 2 exact alias, 1 alias prefix, 0 name substring. */
  tier: 0 | 1 | 2;
}

/** Look up an exercise by exact normalized alias (import-style resolution). */
export function findByAlias(catalog: CatalogV1, name: string): CatalogExercise | null {
  const key = normalizeAlias(name);
  if (key === "") return null;
  const alias = catalog.aliases.find((a) => a.normalizedAlias === key);
  if (!alias) return null;
  return catalog.exercises.find((e) => e.id === alias.exerciseId) ?? null;
}

/** All aliases for an exercise (sorted, as stored). */
export function aliasesForExercise(catalog: CatalogV1, exerciseId: string): CatalogAlias[] {
  return catalog.aliases.filter((a) => a.exerciseId === exerciseId);
}

export function getExerciseById(catalog: CatalogV1, id: string): CatalogExercise | null {
  return catalog.exercises.find((e) => e.id === id) ?? null;
}

export function getExerciseBySlug(catalog: CatalogV1, slug: string): CatalogExercise | null {
  return catalog.exercises.find((e) => e.slug === slug) ?? null;
}

/**
 * Ranking-core mapping bridge: the Hevy exercise_template_id our alias
 * infrastructure attached to this exercise, if any. Feeding this id to the
 * ranking engine (RankCatalog.byId) gives an exact engine catalog match -
 * group and coefficient come from the vendored template instead of keyword
 * inference.
 */
export function hevyTemplateIdFor(catalog: CatalogV1, exerciseId: string): string | null {
  const alias = catalog.aliases.find(
    (a) => a.exerciseId === exerciseId && a.source === "hevy-templates" && a.sourceId != null,
  );
  return alias?.sourceId ?? null;
}

/**
 * Deterministic search: tiered (exact alias > alias prefix > name substring),
 * name-ascending inside each tier. Filters are applied to every tier.
 */
export function searchExercises(catalog: CatalogV1, filters: SearchFilters = {}): ExerciseSearchResult[] {
  const q = filters.query ? normalizeAlias(filters.query) : "";

  const matchesQuery = (ex: CatalogExercise): 0 | 1 | 2 | null => {
    if (q === "") return 0;
    const nameKey = normalizeAlias(ex.name);
    if (nameKey === q) return 2;
    let best: 0 | 1 | 2 | null = null;
    for (const a of catalog.aliases) {
      if (a.exerciseId !== ex.id) continue;
      if (a.normalizedAlias === q) return 2;
      if (a.normalizedAlias.startsWith(q)) best = 1;
    }
    if (best == null && nameKey.includes(q)) best = 0;
    return best;
  };

  const results: ExerciseSearchResult[] = [];
  for (const ex of catalog.exercises) {
    if (filters.majorGroup != null && ex.ranking.group !== filters.majorGroup) continue;
    if (filters.equipment !== undefined && filters.equipment !== null && ex.equipment !== filters.equipment) {
      continue;
    }
    if (filters.equipment === null && ex.equipment !== null) continue;
    if (filters.trackingType != null && ex.trackingType !== filters.trackingType) continue;
    if (filters.rankSupportedOnly === true && ex.ranking.support === "unsupported") continue;
    const tier = matchesQuery(ex);
    if (tier != null) results.push({ exercise: ex, tier });
  }

  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return results.sort(
    (a, b) =>
      b.tier - a.tier ||
      cmp(a.exercise.name, b.exercise.name) ||
      cmp(a.exercise.id, b.exercise.id),
  );
}