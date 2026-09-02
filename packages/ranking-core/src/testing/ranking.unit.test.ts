/**
 * Unit tests for the TypeScript port (spec section 62 requirements):
 * Epley, rep cap, bodyweight weighted/assisted, coefficients, thresholds,
 * minimum sessions, compound weighting, isolation cap, male/female standards,
 * missing bodyweight, next-tier calculation, group inference.
 */
import { describe, expect, it } from "vitest";
import legacyTemplates from "../legacy/data/exercise-templates.json";
import { COMPOSITE_WEIGHTS, GROUPS, MIN_SESSIONS, RANK_TIERS } from "../port/constants.js";
import { effectiveLoad } from "../port/load.js";
import { estimate1RM, sexFactor, weightForReps } from "../port/math.js";
import { inferGroupFromTitle } from "../port/text.js";
import { buildCatalog } from "../port/catalog.js";
import type { RankSession } from "../port/types.js";
import { computeRanks } from "../rank.js";

const templates = legacyTemplates as { id?: string; title?: string; type?: string; primary?: string; equipment?: string }[];
const catalog = buildCatalog(templates);

function oneLiftSessions(title: string, weight: number, reps: number, dates = ["2026-01-05", "2026-01-07", "2026-01-09"]): RankSession[] {
  return dates.map((date) => ({
    date,
    title: "T",
    exercises: [{ title, sets: [{ weight, reps, type: "normal" }] }],
  }));
}

describe("Epley e1RM", () => {
  it("computes 1RM for multi-rep sets", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.6666667, 6);
  });

  it("returns the weight for a single", () => {
    expect(estimate1RM(140, 1)).toBe(140);
  });

  it("caps reps at 12", () => {
    expect(estimate1RM(100, 13)).toBe(estimate1RM(100, 12));
    expect(estimate1RM(100, 12)).toBe(140);
  });

  it("rejects invalid input", () => {
    expect(estimate1RM(0, 5)).toBe(0);
    expect(estimate1RM(100, 0)).toBe(0);
    expect(estimate1RM(-5, 5)).toBe(0);
    expect(estimate1RM(Number.NaN, 5)).toBe(0);
  });
});

describe("reverse Epley", () => {
  it("inverts the e1RM formula", () => {
    expect(weightForReps(estimate1RM(100, 5), 5)).toBeCloseTo(100, 9);
  });

  it("returns the 1RM for a single", () => {
    expect(weightForReps(140, 1)).toBe(140);
  });

  it("rejects invalid input", () => {
    expect(weightForReps(0, 5)).toBe(0);
    expect(weightForReps(140, 0)).toBe(0);
  });
});

describe("sex factor", () => {
  it("uses 0.72 for female standards", () => {
    expect(sexFactor("female")).toBe(0.72);
    expect(sexFactor("Female")).toBe(0.72);
  });

  it("uses 1.0 otherwise", () => {
    expect(sexFactor("male")).toBe(1);
    expect(sexFactor("Male")).toBe(1);
    expect(sexFactor("")).toBe(1);
  });
});

describe("effective load", () => {
  const bw = 80;

  it("uses the logged weight for weight_reps", () => {
    expect(effectiveLoad(100, "weight_reps", bw)).toBe(100);
    expect(effectiveLoad(0, "weight_reps", bw)).toBeNull();
  });

  it("adds weight for bodyweight_weighted", () => {
    expect(effectiveLoad(20, "bodyweight_weighted", bw)).toBe(100);
  });

  it("subtracts assistance for bodyweight_assisted", () => {
    expect(effectiveLoad(40, "bodyweight_assisted", bw)).toBe(40);
  });

  it("skips sets where assistance >= bodyweight", () => {
    expect(effectiveLoad(80, "bodyweight_assisted", bw)).toBeNull();
    expect(effectiveLoad(90, "bodyweight_assisted", bw)).toBeNull();
  });

  it("returns null for untrackable types", () => {
    expect(effectiveLoad(0, "reps_only", bw)).toBeNull();
    expect(effectiveLoad(0, "duration", bw)).toBeNull();
  });
});

describe("constants", () => {
  it("exposes nine tiers in canonical order", () => {
    expect(RANK_TIERS.map((t) => t.name)).toEqual([
      "Bronze", "Iron", "Gold", "Platinum", "Diamond",
      "Titan", "Colossus", "Olympian", "Mythic",
    ]);
  });

  it("exposes the six major groups", () => {
    expect(Object.keys(GROUPS).sort()).toEqual([
      "arms", "back", "chest", "core", "legs", "shoulders",
    ]);
  });

  it("keeps the documented minimum sessions and composite weights", () => {
    expect(MIN_SESSIONS).toBe(3);
    expect(COMPOSITE_WEIGHTS).toEqual([1.0, 0.5, 0.25]);
  });
});

describe("group inference from titles", () => {
  it("routes multilingual titles", () => {
    expect(inferGroupFromTitle("Développé Couché")).toBe("chest");
    expect(inferGroupFromTitle("Presse à Cuisses")).toBe("legs");
    expect(inferGroupFromTitle("Bankdrücken")).toBe("chest");
  });

  it("respects word boundaries", () => {
    // "velo" must not match inside "developpe..."
    expect(inferGroupFromTitle("Développé Couché")).not.toBe("__skip__");
    // "run" (3 chars, no compound tail) must not match inside longer words.
    expect(inferGroupFromTitle("Running Machine")).toBe("__skip__");
  });

  it("flags cardio as skip and unknown titles as null", () => {
    expect(inferGroupFromTitle("Cycling")).toBe("__skip__");
    expect(inferGroupFromTitle("Yoga Flow")).toBe("__skip__");
    expect(inferGroupFromTitle("Super Secret Machine Xyz")).toBeNull();
    expect(inferGroupFromTitle("")).toBeNull();
  });
});

describe("rank computation behavior", () => {
  it("requires minimum sessions - two sessions cap at Platinum", () => {
    const sessions: RankSession[] = [
      { date: "2026-01-05", title: "T", exercises: [{ title: "Barbell Row", sets: [{ weight: 90, reps: 6 }] }] },
      { date: "2026-01-07", title: "T", exercises: [{ title: "Barbell Row", sets: [{ weight: 92.5, reps: 6 }] }] },
    ];
    const result = computeRanks(sessions, catalog, { bodyweightKg: 84.7 });
    const back = result.groups.back;
    expect(back.source).toBe("few_sessions");
    expect(back.capped).toBe(true);
    expect(back.tierIndex ?? 0).toBeLessThanOrEqual(3);
  });

  it("caps isolation-only groups at Titan", () => {
    const result = computeRanks(
      oneLiftSessions("Leg Curl", 60, 10),
      catalog,
      { bodyweightKg: 84.7 },
    );
    const legs = result.groups.legs;
    expect(legs.source).toBe("isolation");
    expect(legs.capped).toBe(true);
    expect(legs.tierIndex ?? 0).toBeLessThanOrEqual(5);
  });

  it("prefers compounds over isolation", () => {
    const sessions: RankSession[] = [
      ...oneLiftSessions("Squat (Barbell)", 140, 5),
      ...oneLiftSessions("Leg Curl", 60, 10),
    ];
    const result = computeRanks(sessions, catalog, { bodyweightKg: 84.7 });
    const legs = result.groups.legs;
    expect(legs.source).toBe("compound");
    expect(legs.capped).toBe(false);
  });

  it("weights the composite [1.0, 0.5, 0.25] over the top 3 compounds", () => {
    const sessions: RankSession[] = [
      ...oneLiftSessions("Bench Press (Barbell)", 100, 5),      // strongest
      ...oneLiftSessions("Incline Dumbbell Press", 50, 5),
      ...oneLiftSessions("Weighted Dip", 10, 5),
      ...oneLiftSessions("Machine Chest Press", 40, 5),
    ];
    const result = computeRanks(sessions, catalog, { bodyweightKg: 84.7 });
    const chest = result.groups.chest;
    expect(chest.used).toHaveLength(3);
    expect(chest.used[0]?.title).toBe("Bench Press (Barbell)");
    const ratios = chest.used.map((l) => l.eqRatio ?? 0);
    expect(ratios).toHaveLength(3);
    const [a, b, c] = ratios as [number, number, number];
    const composite = (a * 1.0 + b * 0.5 + c * 0.25) / 1.75;
    expect(chest.eqRatio).toBeCloseTo(composite, 12);
  });

  it("skips warmup sets", () => {
    const sessions: RankSession[] = [
      { date: "2026-01-05", title: "T", exercises: [{ title: "Bench Press (Barbell)", sets: [{ weight: 60, reps: 8, type: "warmup" }] }] },
      ...oneLiftSessions("Bench Press (Barbell)", 100, 5, ["2026-01-07", "2026-01-09", "2026-01-11"]),
    ];
    const result = computeRanks(sessions, catalog, { bodyweightKg: 84.7 });
    const chest = result.groups.chest;
    expect(chest.used[0]?.reps).toBe(5);
  });

  it("applies female thresholds to identical data", () => {
    const sessions = oneLiftSessions("Bench Press (Barbell)", 100, 5);
    const male = computeRanks(sessions, catalog, { bodyweightKg: 84.7, sex: "male" });
    const female = computeRanks(sessions, catalog, { bodyweightKg: 84.7, sex: "female" });
    expect(female.groups.chest.tierIndex ?? -1)
      .toBeGreaterThanOrEqual(male.groups.chest.tierIndex ?? -1);
  });

  it("reports missing bodyweight without inventing one", () => {
    const result = computeRanks(oneLiftSessions("Bench Press (Barbell)", 100, 5), catalog, {});
    expect(result.bodyweightKg).toBeNull();
    for (const g of Object.values(result.groups)) {
      expect(g.hasData).toBe(false);
      expect(g.eqRatio).toBeNull();
    }
  });

  it("surfaces unmatched strength titles with provenance", () => {
    const sessions = oneLiftSessions("Super Secret Machine Xyz", 80, 5);
    const result = computeRanks(sessions, catalog, { bodyweightKg: 84.7 });
    expect(result.unmatched.has("Super Secret Machine Xyz")).toBe(true);
    const detail = result.unmatchedDetails.get("Super Secret Machine Xyz");
    expect(detail?.reason).toBe("unknown");
    expect(detail?.sessions.size).toBe(3);
  });

  it("silently ignores cardio", () => {
    const result = computeRanks(oneLiftSessions("Running", 0, 30), catalog, { bodyweightKg: 84.7 });
    expect(result.unmatched.size).toBe(0);
    expect(result.unmatchedDetails.size).toBe(0);
  });

  it("computes next-tier recommendations for uncapped groups", () => {
    const result = computeRanks(oneLiftSessions("Bench Press (Barbell)", 60, 5), catalog, { bodyweightKg: 84.7 });
    const chest = result.groups.chest;
    const rec = chest.recommendation;
    expect(rec).not.toBeNull();
    expect(rec?.nextTier.name).toBe(chest.next?.tier.name);
    expect(rec?.required1RM).toBeGreaterThan(0);
    expect(rec?.targetForReps.reps).toBeGreaterThan(0);
  });

  it("stamps every calculation with the ranking version", () => {
    const result = computeRanks(oneLiftSessions("Bench Press (Barbell)", 100, 5), catalog, { bodyweightKg: 84.7 });
    expect(result.rankingVersion).toBe("hevy-ranks-compatible-v1");
  });
});

describe("overall rank", () => {
  it("is explicitly disabled", async () => {
    const { RANKING_CONFIG } = await import("../config.js");
    expect(RANKING_CONFIG.overallRankEnabled).toBe(false);
  });
});

// keep the unused import check honest: buildCatalog is re-exported indirectly
void buildCatalog;