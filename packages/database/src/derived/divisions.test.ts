import { describe, expect, it } from "vitest";
import { divisionForProgress, progressWithinTier, tierName, TOP_TIER_INDEX, sameScore } from "./divisions";
import { GROUPS, RANK_TIERS } from "@openrank/ranking-core";
import { weightQualifierKey } from "./qualifier";

describe("division boundaries (spec N - exact)", () => {
  const top = TOP_TIER_INDEX;

  it("maps 0..25% to IV, 25..50% to III, 50..75% to II, 75..100% to I", () => {
    expect(divisionForProgress(0, 0, top)).toBe("IV");
    expect(divisionForProgress(0.1, 0, top)).toBe("IV");
    expect(divisionForProgress(0.249999, 0, top)).toBe("IV");
    expect(divisionForProgress(0.25, 0, top)).toBe("III");
    expect(divisionForProgress(0.499999, 0, top)).toBe("III");
    expect(divisionForProgress(0.5, 0, top)).toBe("II");
    expect(divisionForProgress(0.749999, 0, top)).toBe("II");
    expect(divisionForProgress(0.75, 0, top)).toBe("I");
    expect(divisionForProgress(1, 0, top)).toBe("I");
  });

  it("clamps out-of-range input deterministically", () => {
    expect(divisionForProgress(-0.5, 3, top)).toBe("IV");
    expect(divisionForProgress(1.5, 3, top)).toBe("I");
    expect(divisionForProgress(null, 3, top)).toBe("IV");
    expect(divisionForProgress(Number.NaN, 3, top)).toBe("IV");
  });

  it("Mythic (top tier) has no division", () => {
    expect(divisionForProgress(0.9, top, top)).toBeNull();
    expect(divisionForProgress(1, top, top)).toBeNull();
    expect(divisionForProgress(null, top, top)).toBeNull();
  });

  it("works identically for every non-top tier", () => {
    for (let t = 0; t < top; t++) {
      expect(divisionForProgress(0.26, t, top)).toBe("III");
      expect(divisionForProgress(0.76, t, top)).toBe("I");
    }
  });

  it("tier names match the frozen tier table", () => {
    expect(tierName(0)).toBe(RANK_TIERS[0]!.name);
    expect(tierName(5)).toBe("Titan");
    expect(tierName(top)).toBe("Mythic");
  });

  it("progressWithinTier mirrors the engine formula (incl. group thresholds)", () => {
    const legs = GROUPS.legs!.thresholds;
    // between Gold(0.75) and Platinum(1.0), male factor 1:
    expect(progressWithinTier(0.8, 2, legs, 1)).toBeCloseTo((0.8 - 0.75) / 0.25, 12);
    // female factor shifts both bounds (0.75*0.72=0.54 .. 1.0*0.72=0.72):
    expect(progressWithinTier(0.63, 2, legs, 0.72)).toBeCloseTo(0.5, 12);
    // top tier -> null
    expect(progressWithinTier(99, 8, legs, 1)).toBeNull();
  });

  it("sameScore is float-tolerant but not loose", () => {
    expect(sameScore(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameScore(1, 1 + 1e-6)).toBe(false);
  });
});

describe("weight qualifier normalization (spec J)", () => {
  it("normalizes to 4-decimal canonical kg with shortest JS rendering", () => {
    expect(weightQualifierKey(100)).toBe("w=100");
    expect(weightQualifierKey(102.5)).toBe("w=102.5");
    expect(weightQualifierKey(102.123456)).toBe("w=102.1235");
    expect(weightQualifierKey(0.00004)).toBe("w=0");
  });

  it("unit-conversion noise collapses to one qualifier (225 lb case)", () => {
    // 225 lb -> 102.058... kg with long binary noise depending on path.
    const a = 225 * 0.45359237;
    const b = Number("102.05828325000001"); // long binary-noise rendering
    expect(weightQualifierKey(a)).toBe(weightQualifierKey(b));
    expect(weightQualifierKey(a)).toBe("w=102.0583");
  });

  it("distinguishes genuinely different weights", () => {
    expect(weightQualifierKey(100)).not.toBe(weightQualifierKey(100.0001));
  });

  it("pure bodyweight (null) is w=0 and equals zero weight", () => {
    expect(weightQualifierKey(null)).toBe("w=0");
    expect(weightQualifierKey(null)).toBe(weightQualifierKey(0));
  });
});