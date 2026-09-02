/**
 * Deterministic catalog build pipeline (pure - no fs, no network):
 * pinned upstream dataset -> validation -> normalization -> canonical schema
 * -> sorted, byte-stable catalog.v1.
 */
import type {
  BuildStats,
  CatalogAlias,
  CatalogExercise,
  CatalogSourceInfo,
  CatalogV1,
  HevyTemplate,
  RawExercise,
} from "./schema";
import {
  FREE_DB_MUSCLE_TO_ID,
  MUSCLES,
  majorGroupForMuscles,
} from "./taxonomy";

/** Machine-independent string comparison (code-unit order). */
const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
import {
  inferTrackingType,
  normalizeCategory,
  normalizeEquipment,
  normalizeForce,
  normalizeMechanic,
  RANK_ELIGIBLE_CATEGORIES,
  slugify,
} from "./normalize";
import { buildAliases, SOURCE_FREE_EXERCISE_DB, type AliasOverride } from "./aliases";
import { validateCatalog, validateRawExercises } from "./validation";

export interface BuildCatalogInput {
  upstream: readonly RawExercise[];
  hevyTemplates: readonly HevyTemplate[];
  /** Curated import-compatibility aliases (validated, highest precedence). */
  overrides?: readonly AliasOverride[];
  /** Primary dataset provenance (from datasets/sources.lock.json). */
  source: CatalogSourceInfo;
  /** Alias-source provenance (e.g. the vendored Hevy templates). */
  aliasSources: readonly CatalogSourceInfo[];
  rankingCompatibility: string;
}

export interface BuildCatalogOutput {
  catalog: CatalogV1;
  stats: BuildStats;
}

function assertNoIssues(issues: readonly { code: string; message: string; subject?: string | undefined }[]): void {
  if (issues.length > 0) {
    const detail = issues
      .slice(0, 10)
      .map((i) => i.code + (i.subject ? " [" + i.subject + "]" : "") + ": " + i.message)
      .join("; ");
    throw new Error("catalog validation failed (" + String(issues.length) + " issues): " + detail);
  }
}

function increment(map: Record<string, number>, key: string | null): void {
  const k = key === null ? "(none)" : key;
  map[k] = (map[k] ?? 0) + 1;
}

function normalizeExercise(raw: RawExercise): CatalogExercise {
  const name = raw.name.trim();
  const category = normalizeCategory(raw.category);
  const equipment = normalizeEquipment(raw.equipment ?? null);
  const primaryMuscles = [
    ...new Set((raw.primaryMuscles ?? []).map((m) => FREE_DB_MUSCLE_TO_ID[m] ?? m)),
  ].sort();
  const secondaryMuscles = [
    ...new Set((raw.secondaryMuscles ?? []).map((m) => FREE_DB_MUSCLE_TO_ID[m] ?? m)),
  ]
    .filter((m) => !primaryMuscles.includes(m))
    .sort();
  const group = majorGroupForMuscles(primaryMuscles);
  const eligible = RANK_ELIGIBLE_CATEGORIES.has(category) && group !== null;
  return {
    id: "fdb:" + slugify(name),
    slug: slugify(name),
    name,
    category,
    mechanic: normalizeMechanic(raw.mechanic ?? null),
    force: normalizeForce(raw.force ?? null),
    equipment,
    trackingType: inferTrackingType(category, equipment, name),
    isCustom: false,
    source: SOURCE_FREE_EXERCISE_DB,
    sourceId: raw.id,
    primaryMuscles,
    secondaryMuscles,
    instructions: (raw.instructions ?? []).map((s) => s),
    images: (raw.images ?? []).map((s) => s),
    ranking: { group, eligible },
  };
}

/** Slug uniqueness: deterministic suffix on collision (sorted-name order). */
function assignUniqueSlugs(exercises: CatalogExercise[]): void {
  const used = new Map<string, number>();
  for (const ex of exercises) {
    const count = used.get(ex.slug) ?? 0;
    used.set(ex.slug, count + 1);
    if (count > 0) {
      const unique = ex.slug + "-" + String(count + 1);
      ex.slug = unique;
      ex.id = "fdb:" + unique;
    }
  }
}

export function buildCatalogPipeline(input: BuildCatalogInput): BuildCatalogOutput {
  // 1. Validation of the pinned upstream snapshot.
  assertNoIssues(validateRawExercises(input.upstream));

  // 2. Normalization into the canonical schema.
  const normalized = input.upstream
    .map((raw) => normalizeExercise(raw))
    .sort((a, b) => cmp(a.name, b.name));
  assignUniqueSlugs(normalized);
  const exercises = normalized.sort((a, b) => cmp(a.id, b.id));

  // 3. Alias infrastructure (exact, normalized, variants, Hevy import).
  const aliasResult = buildAliases(exercises, input.hevyTemplates, input.overrides ?? []);
  const aliases: CatalogAlias[] = aliasResult.aliases;

  // 4. Assemble + validate the whole catalog.
  const catalog: CatalogV1 = {
    schemaVersion: 1,
    rankingCompatibility: input.rankingCompatibility,
    source: input.source,
    aliasSources: [...input.aliasSources],
    muscles: [...MUSCLES_SORTED],
    exercises,
    aliases,
  };
  assertNoIssues(validateCatalog(catalog));

  // 5. Deterministic statistics.
  const stats: BuildStats = {
    exercises: exercises.length,
    byCategory: {},
    byEquipment: {},
    byMechanic: {},
    byTrackingType: {},
    rankEligible: 0,
    rankEligibleByGroup: {},
    primaryMuscleUsage: {},
    missingInstructions: 0,
    missingImages: 0,
    aliases: { total: aliases.length, bySource: {}, byKind: {} },
    aliasAmbiguitiesDropped: aliasResult.ambiguousDropped + aliasResult.hevyAmbiguousDropped,
    hevyTemplatesMapped: aliasResult.hevyTemplatesMapped,
    hevyTemplatesUnmapped: aliasResult.hevyTemplatesUnmapped,
    excluded: [],
  };
  for (const ex of exercises) {
    increment(stats.byCategory, ex.category);
    increment(stats.byEquipment, ex.equipment);
    increment(stats.byMechanic, ex.mechanic);
    increment(stats.byTrackingType, ex.trackingType);
    if (ex.ranking.eligible && ex.ranking.group) {
      stats.rankEligible += 1;
      increment(stats.rankEligibleByGroup, ex.ranking.group);
    }
    for (const m of ex.primaryMuscles) increment(stats.primaryMuscleUsage, m);
    if (ex.instructions.length === 0) stats.missingInstructions += 1;
    if (ex.images.length === 0) stats.missingImages += 1;
  }
  for (const a of aliases) {
    increment(stats.aliases.bySource, a.source);
    increment(stats.aliases.byKind, a.kind);
  }
  for (const key of Object.keys(stats.byCategory)) stats.byCategory[key] = stats.byCategory[key] ?? 0;
  return { catalog, stats };
}

const MUSCLES_SORTED: readonly CatalogV1["muscles"][number][] = [...MUSCLES].sort((a, b) => cmp(a.id, b.id));