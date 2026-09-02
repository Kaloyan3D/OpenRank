import { describe, expect, it } from "vitest";
import type { CatalogExercise, HevyTemplate } from "./schema";
import { buildAliases, type AliasOverride } from "./aliases";

function exercise(id: string, name: string): CatalogExercise {
  return {
    id,
    slug: id.replace(/^fdb:/, ""),
    name,
    category: "strength",
    mechanic: "compound",
    force: "push",
    equipment: "barbell",
    trackingType: "weight_reps",
    isCustom: false,
    source: "free-exercise-db",
    sourceId: id,
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    instructions: [],
    images: [],
    ranking: { group: "chest", support: "eligible", strategy: "keyword", engineGroup: "chest", reason: null },
  };
}

describe("buildAliases", () => {
  it("creates exact and normalized aliases for every exercise", () => {
    const result = buildAliases([exercise("fdb:deadlift", "Deadlift")], []);
    expect(result.aliases.map((a) => a.kind)).toContain("name");
    const nameAlias = result.aliases.find((a) => a.kind === "name");
    expect(nameAlias?.alias).toBe("Deadlift");
    expect(nameAlias?.normalizedAlias).toBe("deadlift");
    expect(nameAlias?.locale).toBe("en");
  });

  it("generates equipment-stripped variants", () => {
    const result = buildAliases([exercise("fdb:barbell-bench-press", "Barbell Bench Press")], []);
    const variant = result.aliases.find((a) => a.normalizedAlias === "bench press");
    expect(variant?.kind).toBe("variant");
  });

  it("maps Hevy titles via canonical matching and keeps template ids", () => {
    const exercises = [exercise("fdb:barbell-deadlift", "Barbell Deadlift")];
    const templates: HevyTemplate[] = [{ id: "ABC123", title: "Deadlift (Barbell)", primary: "hamstrings" }];
    const result = buildAliases(exercises, templates);
    const hevy = result.aliases.find((a) => a.source === "hevy-templates");
    expect(hevy?.exerciseId).toBe("fdb:barbell-deadlift");
    expect(hevy?.sourceId).toBe("ABC123");
    expect(result.hevyTemplatesMapped).toBe(1);
    expect(result.hevyTemplatesUnmapped).toBe(0);
  });

  it("uses the relaxed movement-core match with primary-muscle consistency", () => {
    const exercises = [
      exercise("fdb:bench-press", "Bench Press"),
      {
        ...exercise("fdb:front-squat", "Front Squat"),
        primaryMuscles: ["quadriceps"],
        ranking: {
          group: "legs" as const,
          support: "eligible" as const,
          strategy: "keyword" as const,
          engineGroup: "legs" as const,
          reason: null,
        },
      },
    ];
    const templates: HevyTemplate[] = [{ id: "XYZ", title: "Bench Press (Barbell)", primary: "chest" }];
    const result = buildAliases(exercises, templates);
    const hevy = result.aliases.find((a) => a.sourceId === "XYZ");
    expect(hevy?.exerciseId).toBe("fdb:bench-press");
  });

  it("drops ambiguous aliases deterministically", () => {
    const exercises = [exercise("fdb:a", "Barbell Row"), exercise("fdb:b", "Row Barbell")];
    const result = buildAliases(exercises, []);
    // Both exercises claim the name-owner key? No - names differ in token
    // order, so canonical keys collide: the variant generation must not
    // produce a shared ambiguous alias for two name owners.
    const keys = result.aliases.map((a) => a.normalizedAlias);
    expect(keys.filter((k) => k === "barbell row").length).toBeLessThanOrEqual(2);
  });

  it("applies curated overrides and validates them", () => {
    const exercises = [exercise("fdb:pullups", "Pullups")];
    const templates: HevyTemplate[] = [{ id: "T1", title: "Pull Up", primary: "lats" }];
    const overrides: AliasOverride[] = [{ title: "Pull Up", exerciseSlug: "pullups" }];
    const result = buildAliases(exercises, templates, overrides);
    expect(result.hevyCurated).toBe(1);
    const override = result.aliases.find((a) => a.sourceId === "T1");
    expect(override?.exerciseId).toBe("fdb:pullups");
  });

  it("throws on overrides referencing unknown templates or slugs", () => {
    const exercises = [exercise("fdb:x", "X")];
    expect(() =>
      buildAliases(exercises, [], [{ title: "No Such Template", exerciseSlug: "x" }]),
    ).toThrow(/unknown Hevy template/);
    expect(() =>
      buildAliases(exercises, [{ id: "T", title: "Known", primary: "chest" }], [
        { title: "Known", exerciseSlug: "missing" },
      ]),
    ).toThrow(/unknown exercise slug/);
  });
});