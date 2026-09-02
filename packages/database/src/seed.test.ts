import { describe, expect, it } from "vitest";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import { catalogFingerprint, installedFingerprint, seedCatalog } from "./seed";
import { catalog, openTestDb, deterministicRepos } from "./testing/helpers";

function counts(driver: ReturnType<typeof openTestDb>["driver"]) {
  const c = (sql: string): number => {
    const row = driver.get(sql);
    return Number(row?.n ?? 0);
  };
  return {
    exercises: c("SELECT COUNT(*) AS n FROM exercises"),
    muscles: c("SELECT COUNT(*) AS n FROM muscles"),
    junctions: c("SELECT COUNT(*) AS n FROM exercise_muscles"),
    aliases: c("SELECT COUNT(*) AS n FROM exercise_aliases"),
    instructions: c("SELECT COUNT(*) AS n FROM exercise_instructions"),
    media: c("SELECT COUNT(*) AS n FROM exercise_media"),
  };
}

describe("catalog seeding", () => {
  it("seeds the full Phase 2 catalog", () => {
    const { driver, repos } = openTestDb();
    expect(repos.seedUnchanged).toBe(false);
    const c = counts(driver);
    expect(c.exercises).toBe(876);
    expect(c.muscles).toBe(17);
    expect(c.aliases).toBe(1079);
    expect(c.instructions).toBeGreaterThan(0);
    expect(c.media).toBeGreaterThan(0);
    // Junctions = primary + secondary references across the catalog.
    let expected = 0;
    for (const e of catalog.exercises) expected += e.primaryMuscles.length + e.secondaryMuscles.length;
    expect(c.junctions).toBe(expected);
  });

  it("is idempotent: reseeding the same catalog changes nothing", () => {
    const { driver, repos } = openTestDb();
    const before = counts(driver);
    // Force a full reseed of the same catalog.
    const fp = catalogFingerprint(catalog);
    seedCatalog(driver, catalog, { fingerprint: fp, seededAtUtc: new Date().toISOString() });
    const after = counts(driver);
    expect(after).toEqual(before);
    // A further seed run reports the fingerprint as already installed.
    const again = seedCatalog(driver, catalog, { fingerprint: fp, seededAtUtc: new Date().toISOString() });
    expect(again.unchanged).toBe(true);
    expect(counts(driver)).toEqual(before);
    void repos;
  });

  it("is deterministic: stable row ids and fingerprint", () => {
    const fp1 = catalogFingerprint(catalog);
    const fp2 = catalogFingerprint(JSON.parse(JSON.stringify(catalog)) as CatalogV1);
    expect(fp1).toBe(fp2);
    const a = deterministicRepos();
    const b = deterministicRepos();
    const ids = (d: typeof a.driver) =>
      d.all("SELECT id FROM exercise_aliases ORDER BY id LIMIT 20").map((r) => String(r.id));
    expect(ids(b.driver)).toEqual(ids(a.driver));
  });

  it("preserves user-created exercises and user aliases across reseeds", () => {
    const { driver, repos } = deterministicRepos();
    const custom = repos.exercise.createCustom({
      name: "My Basement Zercher Squat",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: null,
      trackingType: "weight_reps",
      primaryMuscles: ["quadriceps"],
      aliases: ["basement zercher"],
    });
    expect(custom.isCustom).toBe(true);
    expect(custom.source).toBe("user");

    // Reseed.
    seedCatalog(driver, catalog, {
      fingerprint: catalogFingerprint(catalog),
      seededAtUtc: new Date().toISOString(),
    });

    // The custom exercise (and its alias) survived.
    expect(repos.exercise.findById(custom.id)).not.toBeNull();
    const resolved = repos.exercise.resolveAlias("basement zercher");
    expect(resolved?.id).toBe(custom.id);
    // Dataset row count unchanged (876 dataset + 1 custom).
    const c = counts(driver);
    expect(c.exercises).toBe(877);
  });

  it("updates dataset rows in place when the catalog changes", () => {
    const { driver, repos } = deterministicRepos();
    // Simulate a catalog upgrade: rename one exercise.
    const upgraded: CatalogV1 = JSON.parse(JSON.stringify(catalog)) as CatalogV1;
    upgraded.exercises[0]!.name = "Renamed Exercise v2";
    seedCatalog(driver, upgraded, {
      fingerprint: catalogFingerprint(upgraded),
      seededAtUtc: new Date().toISOString(),
    });
    expect(repos.exercise.findById(upgraded.exercises[0]!.id)?.name).toBe("Renamed Exercise v2");
    // Still 876 dataset rows - an update, not a duplicate.
    expect(counts(driver).exercises).toBe(876);
    expect(installedFingerprint(driver)).toBe(catalogFingerprint(upgraded));
  });

  it("records catalog metadata (fingerprint, commit, ranking compatibility)", () => {
    const { driver } = openTestDb();
    const meta = (key: string): string =>
      String(driver.get("SELECT value FROM catalog_meta WHERE key = ?", [key])?.value);
    expect(meta("fingerprint")).toBe(catalogFingerprint(catalog));
    expect(meta("dataset_commit")).toBe(catalog.source.commit);
    expect(meta("ranking_compatibility")).toBe("hevy-ranks-compatible-v1");
    expect(meta("seeded_at")).toBeTruthy();
  });
});