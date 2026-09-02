import { describe, expect, it } from "vitest";
import { deterministicRepos, openTestDb } from "./testing/helpers";

/** A dataset alias whose display text differs from its normalized key. */
function firstVariantAliasText(): string | null {
  const { driver } = openTestDb();
  const row = driver.get(
    "SELECT alias FROM exercise_aliases WHERE alias != normalized_alias AND source = 'free-exercise-db' ORDER BY alias LIMIT 1",
  );
  return row ? String(row.alias) : null;
}

describe("ExerciseRepository", () => {
  it("finds by id and slug", () => {
    const { repos } = deterministicRepos();
    const bySlug = repos.exercise.findBySlug("barbell-curl");
    expect(bySlug).not.toBeNull();
    expect(bySlug!.name.toLowerCase()).toContain("curl");
    expect(repos.exercise.findById(bySlug!.id)?.id).toBe(bySlug!.id);
    expect(repos.exercise.findBySlug("does-not-exist")).toBeNull();
  });

  it("carries ranking-support metadata from the seed", () => {
    const { repos } = deterministicRepos();
    const ex = repos.exercise.findBySlug("barbell-curl")!;
    expect(ex.rankingEligibility).toBe("eligible");
    // "Bicep Curl (Barbell)" -> barbell-curl is a curated Hevy bridge.
    expect(ex.rankingStrategy).toBe("curated");
    expect(ex.rankingGroup).toBe("arms");
    expect(ex.rankingReason).toBeNull();
    const mobility = repos.exercise.findBySlug("hamstring-stretch")! ?? repos.exercise.search({ query: "hamstring stretch", limit: 1 })[0];
    if (mobility) {
      expect(mobility.rankingEligibility).toBe("unsupported");
      expect(mobility.rankingReason).toBeTruthy();
    }
  });

  it("searches by query with alias ranking (exact alias first)", () => {
    const { repos } = deterministicRepos();
    const results = repos.exercise.search({ query: "bench press", limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // The curated Hevy alias "Bench Press (Barbell)" points at the medium-grip
    // bench; exact alias hits must outrank substring matches.
    const names = results.map((r) => r.name.toLowerCase());
    expect(names.some((n) => n.includes("bench press"))).toBe(true);
  });

  it("filters by major group, tracking type, equipment and rank support", () => {
    const { repos } = deterministicRepos();
    const legs = repos.exercise.search({ majorGroup: "legs", limit: 500 });
    expect(legs.length).toBeGreaterThan(100);
    // Anatomical group filter: every hit has a primary muscle in the legs
    // group (mobility stretches count too - this is not a category filter).
    for (const e of legs) {
      expect(repos.exercise.getPrimaryMuscleGroups(e.id)).toContain("legs");
    }

    const bodyweight = repos.exercise.search({ equipment: null, limit: 500 });
    expect(bodyweight.every((e) => e.equipment === null)).toBe(true);

    const duration = repos.exercise.search({ trackingType: "duration", limit: 500 });
    expect(duration.every((e) => e.trackingType === "duration")).toBe(true);
    expect(duration.length).toBe(137);

    const supported = repos.exercise.search({ rankSupportedOnly: true, limit: 1000 });
    expect(supported.length).toBe(488);
    expect(supported.every((e) => e.rankingEligibility !== "unsupported")).toBe(true);
  });

  it("listRankSupported returns exactly the 488 participating exercises", () => {
    const { repos } = deterministicRepos();
    expect(repos.exercise.listRankSupported().length).toBe(488);
  });

  it("resolves aliases (exact, variant, curated Hevy)", () => {
    const { repos } = deterministicRepos();
    // Dataset alias.
    const curl = repos.exercise.resolveAlias("Barbell Curl");
    expect(curl?.slug).toBe("barbell-curl");
    // A generated variant alias: display text differs from its normalized key.
    const variantAlias = firstVariantAliasText();
    if (variantAlias !== null) {
      expect(repos.exercise.resolveAlias(variantAlias)).not.toBeNull();
    }
    // Curated Hevy alias (override file): "Pull Up" -> pullups.
    const pullUp = repos.exercise.resolveAlias("Pull Up");
    expect(pullUp?.slug).toBe("pullups");
    // No collision between different exercises.
    expect(repos.exercise.resolveAlias("zzz unknown lift")).toBeNull();
  });

  it("returns muscles, muscle groups, instructions and media for the detail screen", () => {
    const { repos } = deterministicRepos();
    const ex = repos.exercise.findBySlug("pullups") ?? repos.exercise.search({ query: "pull up", limit: 1 })[0]!;
    const muscles = repos.exercise.getMuscles(ex.id);
    expect(muscles.length).toBeGreaterThan(0);
    expect(muscles[0]!.role).toBe("primary");
    expect(muscles[0]!.name).not.toBeNull();
    const groups = repos.exercise.getPrimaryMuscleGroups(ex.id);
    expect(groups.length).toBeGreaterThan(0);

    const bench = repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const instructions = repos.exercise.getInstructions(bench.id);
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions[0]!.length).toBeGreaterThan(0);
    const media = repos.exercise.getMedia(bench.id);
    expect(media.length).toBeGreaterThan(0);
    expect(media[0]!.kind).toBe("image");
    expect(media[0]!.remoteUrl).toContain("raw.githubusercontent.com/yuhonas/free-exercise-db/");
    expect(media[0]!.localPath).toBeNull();
    expect(media[0]!.license).toBe("Unlicense");
  });

  it("returns aliases and the full detail aggregate", () => {
    const { repos } = deterministicRepos();
    const bench = repos.exercise.resolveAlias("Bench Press (Barbell)")!;
    const aliases = repos.exercise.getAliases(bench.id);
    expect(aliases.some((a) => a.source === "hevy-templates")).toBe(true);
    const detail = repos.exercise.getDetail(bench.id);
    expect(detail?.exercise.id).toBe(bench.id);
    expect(detail?.primaryMuscles.length ?? 0).toBeGreaterThan(0);
    expect(detail?.media.length ?? 0).toBeGreaterThan(0);
    expect(repos.exercise.getDetail("fdb:missing")).toBeNull();
  });

  it("creates user custom exercises with unique slugs and alias resolution", () => {
    const { repos } = deterministicRepos();
    const custom = repos.exercise.createCustom({
      name: "Landmine Squat Press",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
      primaryMuscles: ["quadriceps"],
      secondaryMuscles: ["glutes"],
      instructions: ["Set up the bar", "Press and squat"],
      aliases: ["landmine squat-press"],
    });
    expect(custom.isCustom).toBe(true);
    expect(custom.source).toBe("user");
    expect(custom.slug).toBe("landmine-squat-press");
    expect(custom.rankingEligibility).toBe("unsupported");
    expect(custom.rankingReason).toBe("user-created exercise");
    expect(repos.exercise.resolveAlias("landmine squat press")?.id).toBe(custom.id);
    expect(repos.exercise.getInstructions(custom.id)).toEqual(["Set up the bar", "Press and squat"]);
    // Second custom with the same name gets a suffixed slug, not a conflict.
    const second = repos.exercise.createCustom({
      name: "Landmine Squat Press",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
    });
    expect(second.slug).toBe("landmine-squat-press-2");
  });
});