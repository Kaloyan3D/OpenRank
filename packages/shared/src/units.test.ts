import { describe, expect, it } from "vitest";
import { KG_PER_LB, formatWeight, kgToLb, lbToKg } from "./units.js";

describe("unit conversion", () => {
  it("uses the exact international pound definition", () => {
    expect(KG_PER_LB).toBe(0.45359237);
  });

  it("converts pounds to kilograms", () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 12);
    expect(lbToKg(1000)).toBeCloseTo(453.59237, 9);
  });

  it("converts kilograms to pounds", () => {
    expect(kgToLb(84.7)).toBeCloseTo(186.731536, 5);
    expect(kgToLb(100)).toBeCloseTo(220.4622622, 6);
  });

  it("round-trips within floating point tolerance", () => {
    for (const kg of [0, 40, 84.7, 120.5, 250]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
    }
  });

  it("formats weights for display", () => {
    expect(formatWeight(102.5, "metric")).toBe("102.5 kg");
    expect(formatWeight(102.5, "imperial")).toBe("226.0 lb");
  });
});
