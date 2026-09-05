import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Exercise } from "@openrank/domain";
import { buildCatalogPipeline } from "./build";
import { classifyRankingSupport } from "./ranking-coverage";
import { toDomainExercise, toDomainMuscles } from "./adapter";
import type { CatalogExercise, CatalogV1, HevyTemplate, RawExercise } from "./schema";
import type { CatalogTemplate } from "@openrank/ranking-core";

const ROOT_UPSTREAM = new URL("../../../datasets/upstream/free-exercise-db/exercises.json", import.meta.url);
const ROOT_TEMPLATES = new URL("../../ranking-core/src/legacy/data/exercise-templates.json", import.meta.url);
const OVERRIDES = new URL("../data/hevy-alias-overrides.json", import.meta.url);
const BUILT = new URL("../data/catalog.v1.json", import.meta.url);

function raw(overrides: Partial<RawExercise> = {}): RawExercise {
  return {
    id: "Test_Exercise",
    name: "Test Exercise",
    force: "push",
    mechanic: "compound",
    equipment: "barbell",
    primaryMuscles: ["chest"],
    secondaryMuscles: ["triceps"],
    instructions: ["Step one"],
    category: "strength",
    images: [],
    ...overrides,
  };
}

function pipeline(upstream: RawExercise[]) {
  return buildCatalogPipeline({
    upstream,
    hevyTemplates: [],
    source: { name: "test", repositoryUrl: "https://example.test", commit: "deadbeef", license: "Unlicense", datasetSha256: "0".repeat(64) },
    aliasSources: [],
    rankingCompatibility: "test",
  });
}

describe("buildCatalogPipeline", () => {
  it("normalizes into the canonical schema", () => {
    const { catalog } = pipeline([raw()]);
    expect(catalog.exercises).toHaveLength(1);
    const ex = catalog.exercises[0] as CatalogExercise;
    expect(ex).toMatchObject({
      id: "fdb:test-exercise",
      slug: "test-exercise",
      name: "Test Exercise",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
      isCustom: false,
      source: "free-exercise-db",
      sourceId: "Test_Exercise",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps"],
    });
    expect(ex.ranking).toEqual({
      group: "chest",
      support: "eligible",
      strategy: "keyword",
      engineGroup: "chest",
      reason: null,
    });
  });

  it("generates stable canonical ids (id and slug derive deterministically)", () => {
    const a = pipeline([raw(), raw({ id: "Second_One", name: "Second One" })]).catalog;
    const b = pipeline([raw(), raw({ id: "Second_One", name: "Second One" })]).catalog;
    expect(a.exercises.map((e) => e.id)).toEqual(b.exercises.map((e) => e.id));
    expect(a.exercises.map((e) => e.id)).toEqual(["fdb:second-one", "fdb:test-exercise"]);
  });

  it("maps muscles through the canonical taxonomy (middle back -> upper_back)", () => {
    const { catalog } = pipeline([raw({ primaryMuscles: ["middle back"], secondaryMuscles: ["middle back", "traps"] })]);
    const ex = catalog.exercises[0] as CatalogExercise;
    expect(ex.primaryMuscles).toEqual(["upper_back"]);
    expect(ex.secondaryMuscles).toEqual(["traps"]);
    expect(ex.ranking.group).toBe("back");
  });

  it("is deterministic: two builds produce byte-identical output", { timeout: 30_000 }, () => {
    const upstream = JSON.parse(readFileSync(ROOT_UPSTREAM, "utf8")) as RawExercise[];
    const templates = JSON.parse(readFileSync(ROOT_TEMPLATES, "utf8")) as { id?: string; title?: string }[];
    const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8")) as { overrides: { title: string; exerciseSlug: string }[] };
    const source = { name: "free-exercise-db", repositoryUrl: "https://github.com/yuhonas/free-exercise-db", commit: "a859101d633a01c4a1a920d6a8ce41dabba0705f", license: "Unlicense", datasetSha256: "0".repeat(64) };
    const aliasSources = [{ name: "hevy-ranks-exercise-templates", repositoryUrl: "https://github.com/BenjiPy/hevy-ranks", commit: "ad4ced63f0d1b5c89920619ec3a00da8beace50d", license: "MIT", datasetSha256: "0".repeat(64) }];
    const classify = (ctx: Parameters<typeof classifyRankingSupport>[3] extends never ? never : { exercises: readonly CatalogExercise[]; curatedExerciseIds: ReadonlySet<string>; templateIdOf: (id: string) => string | null }) =>
      classifyRankingSupport(ctx.exercises, templates as unknown as CatalogTemplate[], ctx);
    const first = buildCatalogPipeline({ upstream, hevyTemplates: templates as unknown as HevyTemplate[], overrides: overrides.overrides, source, aliasSources, rankingCompatibility: "hevy-ranks-compatible-v1", classify });
    const second = buildCatalogPipeline({ upstream, hevyTemplates: templates as unknown as HevyTemplate[], overrides: overrides.overrides, source, aliasSources, rankingCompatibility: "hevy-ranks-compatible-v1", classify });
    expect(JSON.stringify(first.catalog)).toBe(JSON.stringify(second.catalog));
  });

  // Full-catalog pipeline rebuild - the sibling deterministic build above
  // already documents this workload at 30s; the 5s default is a latent flake
  // on slower machines. The byte-for-byte assertion itself is unchanged.
  it("the committed catalog.v1.json matches a fresh pipeline build byte-for-byte", { timeout: 30_000 }, () => {
    const committed = readFileSync(BUILT, "utf8");
    const parsed = JSON.parse(committed) as CatalogV1;
    const upstream = JSON.parse(readFileSync(ROOT_UPSTREAM, "utf8")) as RawExercise[];
    const templates = JSON.parse(readFileSync(ROOT_TEMPLATES, "utf8")) as { id?: string; title?: string }[];
    const overrides = JSON.parse(readFileSync(OVERRIDES, "utf8")) as { overrides: { title: string; exerciseSlug: string }[] };
    const rebuilt = buildCatalogPipeline({
      upstream,
      hevyTemplates: templates as unknown as HevyTemplate[],
      overrides: overrides.overrides,
      source: parsed.source,
      aliasSources: parsed.aliasSources,
      rankingCompatibility: parsed.rankingCompatibility,
      classify: ({ exercises, curatedExerciseIds, templateIdOf }) =>
        classifyRankingSupport(exercises, templates as unknown as CatalogTemplate[], {
          curatedExerciseIds,
          templateIdOf,
        }),
    });
    expect(JSON.stringify(rebuilt.catalog)).toBe(JSON.stringify(parsed));
  });

  it("fails loudly on upstream drift", () => {
    expect(() => pipeline([raw({ category: "ultra" })])).toThrow(/catalog validation failed/);
  });

  it("keeps stats consistent with the catalog", () => {
    const { stats, catalog } = pipeline([raw(), raw({ id: "Walk", name: "Walk", category: "cardio", equipment: null, primaryMuscles: [] })]);
    expect(stats.exercises).toBe(catalog.exercises.length);
    expect(stats.byCategory.strength).toBe(1);
    expect(stats.byCategory.cardio).toBe(1);
    expect(stats.rankSupported).toBe(1);
    expect(stats.bySupport.eligible).toBe(1);
    expect(stats.byStrategy.keyword).toBe(1);
  });
});

describe("domain adapter", () => {
  it("maps catalog exercises onto the domain model", () => {
    const { catalog } = pipeline([raw()]);
    const ex = catalog.exercises[0] as CatalogExercise;
    const domain: Exercise = toDomainExercise(ex);
    expect(domain.id).toBe("fdb:test-exercise");
    expect(domain.sourceId).toBe("Test_Exercise");
    expect(domain.isCustom).toBe(false);
  });

  it("maps the muscle taxonomy onto the domain model", () => {
    const catalog = pipeline([raw()]).catalog;
    const muscles = toDomainMuscles(catalog);
    expect(muscles.find((m) => m.id === "chest")?.majorGroup).toBe("chest");
    expect(muscles.length).toBe(catalog.muscles.length);
  });
});