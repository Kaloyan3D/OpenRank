/**
 * Alias infrastructure.
 *
 * The alias index is what exercise search and future workout-importers use to
 * resolve free-form exercise names ("Bench Press (Barbell)", a Hevy CSV title,
 * a localized name) to a canonical OpenRank exercise id. It supports:
 * - exact aliases (the canonical name),
 * - normalized aliases (deburred lookup keys),
 * - generated variants (equipment/qualifier-stripped names),
 * - source-specific names with locale metadata (Hevy import compatibility).
 *
 * Ambiguous aliases (one normalized key resolving to several exercises) are
 * dropped deterministically: a group of conflicting candidates survives only
 * if exactly one of them is an exercise's own name; otherwise the whole group
 * is dropped. This makes the result independent of input ordering.
 */
import type {
  AliasKind,
  CatalogAlias,
  CatalogExercise,
  HevyTemplate,
} from "./schema";
import { canonicalAlias, coreAlias, nameVariants, normalizeAlias } from "./normalize";
import { majorGroupForMuscles } from "./taxonomy";

export const SOURCE_FREE_EXERCISE_DB = "free-exercise-db";
export const SOURCE_HEVY_TEMPLATES = "hevy-templates";
export const ALIAS_LOCALE_DEFAULT = "en";

export interface AliasCandidate {
  exerciseId: string;
  alias: string;
  normalizedAlias: string;
  locale: string;
  source: string;
  sourceId?: string | undefined;
  kind: AliasKind;
}

/** A curated import-compatibility alias override (validated at build time). */
export interface AliasOverride {
  /** Exact title of a Hevy exercise template. */
  title: string;
  /** Slug of the canonical exercise it maps to. */
  exerciseSlug: string;
}

export interface AliasBuildResult {
  aliases: CatalogAlias[];
  ambiguousDropped: number;
  hevyTemplatesMapped: number;
  hevyTemplatesUnmapped: number;
  hevyAmbiguousDropped: number;
  hevyDuplicateSkipped: number;
  hevyRelaxedMatched: number;
  hevyCurated: number;
}

/** Major group a Hevy template's primary muscle implies (null if unknown). */
function hevyMajorGroup(primary: string | undefined): string | null {
  if (!primary) return null;
  const canonicalId = primary === "middle back" ? "upper_back" : primary;
  return majorGroupForMuscles([canonicalId]);
}

interface AliasGroup {
  key: string;
  candidates: AliasCandidate[];
  /** exerciseIds whose own name normalizes to this key. */
  nameOwners: Set<string>;
}

/** Machine-independent (code-unit) string comparison - stable across ICU/locale. */
export function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function dedupeKey(c: AliasCandidate): string {
  return c.exerciseId + "\u0000|" + c.alias + "|" + (c.sourceId ?? "");
}

function groupCandidates(candidates: readonly AliasCandidate[]): Map<string, AliasGroup> {
  const groups = new Map<string, AliasGroup>();
  for (const c of candidates) {
    let g = groups.get(c.normalizedAlias);
    if (!g) {
      g = { key: c.normalizedAlias, candidates: [], nameOwners: new Set() };
      groups.set(c.normalizedAlias, g);
    }
    if (c.kind === "name" && c.source === SOURCE_FREE_EXERCISE_DB) {
      g.nameOwners.add(c.exerciseId);
    }
    g.candidates.push(c);
  }
  return groups;
}

/** Resolve one normalized-key group to 0..1 aliases deterministically. */
function resolveGroup(g: AliasGroup): AliasCandidate | null {
  if (g.candidates.length === 0) return null;
  const seen = new Set<string>();
  const unique = g.candidates.filter((c) => {
    const k = dedupeKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 1) return unique[0] ?? null;
  // Conflicts: prefer the single name-owner, drop everything otherwise.
  if (g.nameOwners.size === 1) {
    const owner = [...g.nameOwners][0];
    const ownerCandidates = unique.filter((c) => c.exerciseId === owner && c.kind === "name");
    if (ownerCandidates.length === 1) return ownerCandidates[0] ?? null;
  }
  return null;
}

function hasConflict(g: AliasGroup): boolean {
  const exercises = new Set(g.candidates.map((c) => c.exerciseId));
  return exercises.size > 1;
}

/** Build the complete alias index for a catalog's exercises. */
export function buildAliases(
  exercises: readonly CatalogExercise[],
  hevyTemplates: readonly HevyTemplate[],
  overrides: readonly AliasOverride[] = [],
): AliasBuildResult {
  const candidates: AliasCandidate[] = [];

  for (const ex of exercises) {
    candidates.push({
      exerciseId: ex.id,
      alias: ex.name,
      normalizedAlias: normalizeAlias(ex.name),
      locale: ALIAS_LOCALE_DEFAULT,
      source: SOURCE_FREE_EXERCISE_DB,
      kind: "name",
    });
    for (const variant of nameVariants(ex.name)) {
      candidates.push({
        exerciseId: ex.id,
        alias: variant,
        normalizedAlias: normalizeAlias(variant),
        locale: ALIAS_LOCALE_DEFAULT,
        source: SOURCE_FREE_EXERCISE_DB,
        kind: "variant",
      });
    }
  }

  // --- resolve the dataset's own aliases --------------------------------
  const groups = groupCandidates(candidates);
  let ambiguousDropped = 0;
  /** normalizedAlias -> exerciseId (exact + variant aliases resolved). */
  const datasetIndex = new Map<string, string>();
  /** Display form of the winning alias per key. */
  const winning = new Map<string, AliasCandidate>();
  for (const g of groups.values()) {
    const resolved = resolveGroup(g);
    if (resolved) {
      datasetIndex.set(g.key, resolved.exerciseId);
      winning.set(g.key, resolved);
    } else if (hasConflict(g)) {
      ambiguousDropped += 1;
    }
  }

  // Canonical (word-order-independent) index over exercise names for fuzzy
  // matching of import-source titles.
  const canonicalIndex = new Map<string, string[]>();
  for (const ex of exercises) {
    const key = canonicalAlias(ex.name);
    if (!key) continue;
    const list = canonicalIndex.get(key);
    if (list) list.push(ex.id);
    else canonicalIndex.set(key, [ex.id]);
  }

  // --- Hevy template aliases (import compatibility) ---------------------
  const result: AliasCandidate[] = [...winning.values()];
  let hevyAmbiguousDropped = 0;
  let hevyDuplicateSkipped = 0;
  let hevyUnmapped = 0;
  let hevyRelaxedMatched = 0;
  let hevyCurated = 0;
  const mappedTemplateIds = new Set<string>();

  // Exercises grouped by movement-core key (equipment words removed).
  const coreIndex = new Map<string, CatalogExercise[]>();
  for (const ex of exercises) {
    const key = coreAlias(ex.name);
    if (!key) continue;
    const list = coreIndex.get(key);
    if (list) list.push(ex);
    else coreIndex.set(key, [ex]);
  }
  /** Pick the unique exercise whose major group matches the template. */
  const uniqueGroupMatch = (candidates: CatalogExercise[], primary: string | undefined): string | undefined => {
    const group = hevyMajorGroup(primary);
    if (group == null) return undefined;
    const consistent = candidates.filter((ex) => ex.ranking.group === group);
    return consistent.length === 1 ? (consistent[0]?.id ?? undefined) : undefined;
  };

  for (const template of hevyTemplates) {
    const title = template.title;
    if (!title) continue;
    const normalized = normalizeAlias(title);
    let exerciseId: string | undefined;
    let matched = false;

    const direct = datasetIndex.get(normalized);
    if (direct) {
      exerciseId = direct;
      matched = true;
    } else {
      const canon = canonicalAlias(title);
      const hits = canon ? canonicalIndex.get(canon) : undefined;
      if (hits && hits.length === 1) {
        exerciseId = hits[0];
        matched = true;
      } else if (hits && hits.length > 1) {
        exerciseId = uniqueGroupMatch(
          hits.map((id) => exercises.find((e) => e.id === id)).filter((e): e is CatalogExercise => e !== undefined),
          template.primary,
        );
        if (exerciseId) matched = true;
        else {
          hevyAmbiguousDropped += 1;
          continue;
        }
      }
    }

    if (!matched || !exerciseId) {
      // Relaxed pass: movement-core key (equipment words stripped) with the
      // template's primary muscle as a consistency constraint.
      const coreKey = coreAlias(title);
      const candidates = coreKey ? (coreIndex.get(coreKey) ?? []) : [];
      if (candidates.length === 1) {
        exerciseId = candidates[0]?.id;
        matched = exerciseId !== undefined;
        if (matched) hevyRelaxedMatched += 1;
      } else if (candidates.length > 1) {
        exerciseId = uniqueGroupMatch(candidates, template.primary);
        if (exerciseId) {
          matched = true;
          hevyRelaxedMatched += 1;
        }
      }
    }

    if (!matched || !exerciseId) {
      hevyUnmapped += 1;
      continue;
    }

    const existing = datasetIndex.get(normalized);
    if (existing !== undefined && existing !== exerciseId) {
      // Conflicts with a different dataset exercise: ambiguous, drop.
      hevyAmbiguousDropped += 1;
      continue;
    }
    if (template.id) mappedTemplateIds.add(template.id);
    const isDuplicate = result.some(
      (c) => c.normalizedAlias === normalized && c.exerciseId === exerciseId,
    );
    if (isDuplicate) {
      // The mapping already exists under an equivalent alias; the template
      // is considered mapped (its resolution is unambiguous).
      hevyDuplicateSkipped += 1;
      continue;
    }

    result.push({
      exerciseId,
      alias: title,
      normalizedAlias: normalized,
      locale: ALIAS_LOCALE_DEFAULT,
      source: SOURCE_HEVY_TEMPLATES,
      sourceId: template.id,
      kind: "import-source",
    });
    datasetIndex.set(normalized, exerciseId);
  }

  // --- curated overrides (highest precedence, validated) ----------------
  const templateByTitle = new Map<string, HevyTemplate>();
  for (const t of hevyTemplates) {
    if (t.title) templateByTitle.set(t.title, t);
  }
  for (const override of overrides) {
    const template = templateByTitle.get(override.title);
    if (!template) {
      throw new Error("alias override references unknown Hevy template title: " + override.title);
    }
    const exercise = exercises.find((e) => e.slug === override.exerciseSlug);
    if (!exercise) {
      throw new Error(
        "alias override references unknown exercise slug: " +
          override.exerciseSlug +
          " (" +
          override.title +
          ")",
      );
    }
    const normalized = normalizeAlias(override.title);
    const existingOwner = datasetIndex.get(normalized);
    if (existingOwner !== undefined && existingOwner !== exercise.id) {
      throw new Error(
        "alias override conflicts with an existing alias: " +
          override.title +
          " -> " +
          existingOwner,
      );
    }
    const already = result.some(
      (c) => c.normalizedAlias === normalized && c.exerciseId === exercise.id,
    );
    if (!already) {
      result.push({
        exerciseId: exercise.id,
        alias: override.title,
        normalizedAlias: normalized,
        locale: ALIAS_LOCALE_DEFAULT,
        source: SOURCE_HEVY_TEMPLATES,
        sourceId: template.id,
        kind: "import-source",
      });
      datasetIndex.set(normalized, exercise.id);
    }
    if (template.id) mappedTemplateIds.add(template.id);
    hevyCurated += 1;
  }

  const aliases: CatalogAlias[] = result
    .map((c) => ({
      exerciseId: c.exerciseId,
      alias: c.alias,
      normalizedAlias: c.normalizedAlias,
      locale: c.locale,
      source: c.source,
      sourceId: c.sourceId,
      kind: c.kind,
    }))
    .sort(
      (x, y) =>
        cmp(x.normalizedAlias, y.normalizedAlias) ||
        cmp(x.exerciseId, y.exerciseId) ||
        cmp(x.alias, y.alias),
    );

  return {
    aliases,
    ambiguousDropped,
    hevyTemplatesMapped: mappedTemplateIds.size,
    hevyTemplatesUnmapped: hevyUnmapped,
    hevyAmbiguousDropped,
    hevyDuplicateSkipped,
    hevyRelaxedMatched,
    hevyCurated,
  };
}