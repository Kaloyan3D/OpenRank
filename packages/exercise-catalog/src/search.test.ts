import { describe, expect, it } from "vitest";
import { buildCatalogPipeline } from "./build";
import { findByAlias, getExerciseBySlug, searchExercises } from "./search";
import type { RawExercise } from "./schema";

function raw(overrides: Partial<RawExercise> = {}): RawExercise {
  return {
    id: "Barbell_Bench_Press",
    name: "Barbell Bench Press",
    force: "push",
    mechanic: "compound",
    equipment: "barbell",
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    instructions: [],
    category: "strength",
    images: [],
    ...overrides,
  };
}

const { catalog } = buildCatalogPipeline({
  upstream: [
    raw(),
    raw({ id: "Push_Up", name: "Push Up", equipment: "body only", mechanic: null, primaryMuscles: ["chest"] }),
    raw({ id: "Squat", name: "Barbell Squat", force: "push", primaryMuscles: ["quadriceps"], secondaryMuscles: [] }),
    raw({ id: "Hamstring_Stretch", name: "Hamstring Stretch", category: "stretching", equipment: null, mechanic: null, force: null, primaryMuscles: ["hamstrings"] }),
  ],
  hevyTemplates: [{ id: "T1", title: "Bench Press (Barbell)", primary: "chest", type: "weight_reps" }],
  source: { name: "t", repositoryUrl: "u", commit: "c", license: "Unlicense", datasetSha256: "0".repeat(64) },
  aliasSources: [],
  rankingCompatibility: "test",
});

describe("searchExercises", () => {
  it("finds by alias prefix and ranks exact matches first", () => {
    const results = searchExercises(catalog, { query: "bench press" });
    expect(results[0]?.exercise.id).toBe("fdb:barbell-bench-press");
    expect(results[0]?.tier).toBe(2);
  });

  it("matches name substrings", () => {
    const results = searchExercises(catalog, { query: "stretch" });
    expect(results.map((r) => r.exercise.id)).toContain("fdb:hamstring-stretch");
  });

  it("is accent-insensitive", () => {
    const results = searchExercises(catalog, { query: "café" });
    expect(results).toHaveLength(0);
    const accents = searchExercises(catalog, { query: "barbell squât" });
    expect(accents.map((r) => r.exercise.id)).toContain("fdb:barbell-squat");
  });

  it("filters by major group and equipment", () => {
    const legs = searchExercises(catalog, { majorGroup: "legs" });
    expect(legs.map((r) => r.exercise.id)).toEqual(["fdb:barbell-squat", "fdb:hamstring-stretch"]);
    const bodyweight = searchExercises(catalog, { equipment: "bodyweight" });
    expect(bodyweight.map((r) => r.exercise.id)).toContain("fdb:push-up");
    const barbell = searchExercises(catalog, { equipment: "barbell" });
    expect(barbell.map((r) => r.exercise.id)).not.toContain("fdb:push-up");
  });

  it("filters by tracking type and rank eligibility", () => {
    const duration = searchExercises(catalog, { trackingType: "duration" });
    expect(duration.map((r) => r.exercise.id)).toEqual(["fdb:hamstring-stretch"]);
    const supported = searchExercises(catalog, { rankSupportedOnly: true });
    expect(supported.map((r) => r.exercise.id)).not.toContain("fdb:hamstring-stretch");
    expect(supported.map((r) => r.exercise.id)).toContain("fdb:barbell-bench-press");
  });
});

describe("findByAlias / getExerciseBySlug", () => {
  it("resolves Hevy-style titles", () => {
    expect(findByAlias(catalog, "Bench Press (Barbell)")?.id).toBe("fdb:barbell-bench-press");
    expect(findByAlias(catalog, "barbell bench press")?.id).toBe("fdb:barbell-bench-press");
    expect(findByAlias(catalog, "nonexistent exercise")).toBeNull();
  });
  it("resolves slugs", () => {
    expect(getExerciseBySlug(catalog, "push-up")?.sourceId).toBe("Push_Up");
  });
});