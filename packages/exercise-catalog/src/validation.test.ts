import { describe, expect, it } from "vitest";
import type { CatalogExercise, CatalogV1, RawExercise } from "./schema";
import { buildCatalogPipeline } from "./build";
import { validateCatalog, validateRawExercises } from "./validation";

function catalogExercise(overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
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
    instructions: ["Step one"],
    images: [],
    ranking: { group: "chest", eligible: true },
    ...overrides,
  };
}

function rawExercise(overrides: Partial<RawExercise> = {}): RawExercise {
  return {
    id: "Test_Exercise",
    name: "Test Exercise",
    force: "push",
    level: "beginner",
    mechanic: "compound",
    equipment: "barbell",
    primaryMuscles: ["chest"],
    secondaryMuscles: ["triceps"],
    instructions: ["Step one"],
    category: "strength",
    images: ["Test Exercise/0.jpg"],
    ...overrides,
  };
}

function minimalCatalog(exercise: CatalogExercise): CatalogV1 {
  return {
    schemaVersion: 1,
    rankingCompatibility: "test",
    source: {
      name: "test",
      repositoryUrl: "https://example.test",
      commit: "deadbeef",
      license: "Unlicense",
      datasetSha256: "0".repeat(64),
    },
    aliasSources: [],
    muscles: [
      { id: "chest", name: "Chest", majorGroup: "chest" },
      { id: "triceps", name: "Triceps", majorGroup: "arms" },
    ],
    exercises: [exercise],
    aliases: [],
  };
}

describe("validateRawExercises", () => {
  it("accepts a well-formed record", () => {
    expect(validateRawExercises([rawExercise()])).toEqual([]);
  });
  it("rejects missing required fields", () => {
    const issues = validateRawExercises([rawExercise({ id: "", name: undefined })]);
    expect(issues.some((i) => i.code === "missing_required_field")).toBe(true);
  });
  it("rejects unknown muscle references", () => {
    const issues = validateRawExercises([rawExercise({ primaryMuscles: ["toe muscles"] })]);
    expect(issues.some((i) => i.code === "invalid_muscle_reference")).toBe(true);
  });
  it("rejects unknown equipment and categories", () => {
    const issues = validateRawExercises([rawExercise({ equipment: "quantum lever", category: "sports" })]);
    expect(issues.some((i) => i.code === "invalid_equipment")).toBe(true);
    expect(issues.some((i) => i.code === "invalid_category")).toBe(true);
  });
  it("rejects duplicate upstream ids and names", () => {
    const issues = validateRawExercises([rawExercise(), rawExercise()]);
    expect(issues.some((i) => i.code === "duplicate_source_id")).toBe(true);
    expect(issues.some((i) => i.code === "duplicate_source_name")).toBe(true);
  });
  it("rejects malformed instruction/image fields", () => {
    const issues = validateRawExercises([
      rawExercise({ instructions: 42 as unknown as string[] }),
    ]);
    expect(issues.some((i) => i.code === "malformed_record")).toBe(true);
  });
});

describe("validateCatalog", () => {
  it("accepts a pipeline-built catalog", () => {
    const { catalog } = buildCatalogPipeline({
      upstream: [rawExercise()],
      hevyTemplates: [],
      source: {
        name: "test",
        repositoryUrl: "https://example.test",
        commit: "deadbeef",
        license: "Unlicense",
        datasetSha256: "0".repeat(64),
      },
      aliasSources: [],
      rankingCompatibility: "test",
    });
    expect(validateCatalog(catalog)).toEqual([]);
  });
  it("detects duplicate canonical ids", () => {
    const { catalog } = buildCatalogPipeline({
      upstream: [rawExercise(), rawExercise({ id: "Other", name: "Other Exercise", primaryMuscles: ["triceps"] })],
      hevyTemplates: [],
      source: {
        name: "test",
        repositoryUrl: "https://example.test",
        commit: "deadbeef",
        license: "Unlicense",
        datasetSha256: "0".repeat(64),
      },
      aliasSources: [],
      rankingCompatibility: "test",
    });
    // Force a duplicate id on purpose.
    const broken: CatalogV1 = { ...catalog, exercises: [catalog.exercises[0] as CatalogExercise, { ...(catalog.exercises[0] as CatalogExercise), name: "Copy", sourceId: "Other" }] };
    const issues = validateCatalog(broken);
    expect(issues.some((i) => i.code === "duplicate_canonical_id")).toBe(true);
  });
  it("detects duplicate slugs", () => {
    const exercise = catalogExercise();
    const catalog = minimalCatalog(exercise);
    catalog.exercises = [exercise, { ...exercise, id: "fdb:other", name: "Other", sourceId: "Other" }];
    const issues = validateCatalog(catalog);
    expect(issues.some((i) => i.code === "duplicate_slug")).toBe(true);
  });
  it("detects invalid tracking types and muscle references", () => {
    const catalog = minimalCatalog(
      catalogExercise({ trackingType: "telepathy" as never, primaryMuscles: ["ghost_muscle"] }),
    );
    const issues = validateCatalog(catalog);
    expect(issues.some((i) => i.code === "invalid_tracking_type")).toBe(true);
    expect(issues.some((i) => i.code === "invalid_muscle_reference")).toBe(true);
  });
  it("detects ambiguous aliases", () => {
    const base = catalogExercise();
    const other = { ...base, id: "fdb:other", slug: "other", name: "Other", sourceId: "Other" };
    const catalog = minimalCatalog(base);
    catalog.exercises = [base, other];
    catalog.aliases = [
      { exerciseId: base.id, alias: "Shared", normalizedAlias: "shared", locale: "en", source: "free-exercise-db", kind: "variant" },
      { exerciseId: other.id, alias: "Shared", normalizedAlias: "shared", locale: "en", source: "free-exercise-db", kind: "variant" },
    ];
    const issues = validateCatalog(catalog);
    expect(issues.some((i) => i.code === "ambiguous_alias")).toBe(true);
  });
  it("detects dangling aliases", () => {
    const catalog = minimalCatalog(catalogExercise());
    catalog.aliases = [
      { exerciseId: "fdb:missing", alias: "Ghost", normalizedAlias: "ghost", locale: "en", source: "free-exercise-db", kind: "variant" },
    ];
    const issues = validateCatalog(catalog);
    expect(issues.some((i) => i.code === "dangling_alias")).toBe(true);
  });
});