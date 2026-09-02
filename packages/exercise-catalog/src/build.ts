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
  RankingSupportInput,
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
  /**
   * Ranking-support classification (Phase 3). Receives the normalized
   * exercises plus the built alias index and returns the engine-derived
   * support metadata per exercise id. The frozen engine stays authoritative;
   * this only records how each exercise currently maps into it.
   */
  classify?: ClassifyExercises;
}

export interface ClassifyContext {
  exercises: readonly CatalogExercise[];
  curatedExerciseIds: ReadonlySet<string>;
  templateIdOf: (exerciseId: string) => string | null;
}

export type ClassifyExercises = (ctx: ClassifyContext) => Record<string, RankingSupportInput>;

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
    ranking: {
      group,
      support: "unsupported",
      strategy: "none",
      engineGroup: null,
      reason: null,
    },
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

  // 3b. Ranking-support classification (external, engine-derived).
  const supportMap = input.classify
    ? input.classify({
        exercises,
        curatedExerciseIds: aliasResult.curatedExerciseIds,
        templateIdOf: (exerciseId) => {
          const alias = aliases.find(
            (a) => a.exerciseId === exerciseId && a.source === SOURCE_HEVY_TEMPLATES && a.sourceId != null,
          );
          return alias?.sourceId ?? null;
        },
      })
    : defaultSupportMap(exercises);
  applySupport(exercises, supportMap);

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
    rankSupported: 0,
    bySupport: {},
    byStrategy: {},
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
    increment(stats.bySupport, ex.ranking.support);
    increment(stats.byStrategy, ex.ranking.strategy);
    if (ex.ranking.support !== "unsupported") stats.rankSupported += 1;
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

const SOURCE_HEVY_TEMPLATES = "hevy-templates";

/**
 * Fallback classifier for builds without an engine-backed classifier (unit
 * tests): strength exercises with a muscle group are treated as keyword-
 * classified against their anatomical group; everything else is unsupported.
 */
function defaultSupportMap(exercises: readonly CatalogExercise[]): Record<string, RankingSupportInput> {
  const map: Record<string, RankingSupportInput> = {};
  for (const ex of exercises) {
    if (RANK_ELIGIBLE_CATEGORIES.has(ex.category) && ex.ranking.group !== null) {
      map[ex.id] = {
        support: "eligible",
        strategy: "keyword",
        engineGroup: ex.ranking.group,
        reason: null,
      };
    } else {
      map[ex.id] = {
        support: "unsupported",
        strategy: "none",
        engineGroup: null,
        reason:
          RANK_ELIGIBLE_CATEGORIES.has(ex.category)
            ? "primary muscles do not map to a ranking group"
            : "category is not rank-supported",
      };
    }
  }
  return map;
}

/** Apply support metadata to exercises (fails loudly on unknown ids). */
function applySupport(
  exercises: CatalogExercise[],
  support: Record<string, RankingSupportInput>,
): void {
  for (const ex of exercises) {
    const entry = support[ex.id];
    if (!entry) {
      throw new Error("ranking classification is missing exercise: " + ex.id);
    }
    ex.ranking = {
      group: ex.ranking.group,
      support: entry.support,
      strategy: entry.strategy,
      engineGroup: entry.engineGroup,
      reason: entry.reason ?? null,
    };
  }
  const known = new Set(exercises.map((e) => e.id));
  for (const id of Object.keys(support)) {
    if (!known.has(id)) {
      throw new Error("ranking classification references unknown exercise: " + id);
    }
  }
}