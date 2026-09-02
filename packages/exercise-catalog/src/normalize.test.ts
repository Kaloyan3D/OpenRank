import { describe, expect, it } from "vitest";
import {
  canonicalAlias,
  coreAlias,
  inferTrackingType,
  nameVariants,
  normalizeAlias,
  normalizeCategory,
  normalizeEquipment,
  normalizeForce,
  normalizeMechanic,
  slugify,
} from "./normalize";

describe("slugify", () => {
  it("kebab-cases simple names", () => {
    expect(slugify("Barbell Bench Press")).toBe("barbell-bench-press");
  });
  it("handles punctuation and slashes", () => {
    expect(slugify("3/4 Sit-Up")).toBe("3-4-sit-up");
    expect(slugify("Pull-up")).toBe("pull-up");
  });
  it("strips accents (deterministic ASCII slugs)", () => {
    expect(slugify("Élévation Latérale")).toBe("elevation-laterale");
  });
  it("is stable for repeated calls", () => {
    expect(slugify(slugify("Dead Bug"))).toBe(slugify("Dead Bug"));
  });
});

describe("normalizeAlias", () => {
  it("deburs and collapses punctuation", () => {
    expect(normalizeAlias("Bench Press (Barbell)")).toBe("bench press barbell");
    expect(normalizeAlias("  Chin-Up! ")).toBe("chin up");
  });
});

describe("canonicalAlias", () => {
  it("is word-order independent", () => {
    expect(canonicalAlias("Bench Press (Barbell)")).toBe(canonicalAlias("Barbell Bench Press"));
  });
  it("drops filler words but keeps equipment discriminators", () => {
    expect(canonicalAlias("Press with the Barbell")).toBe(canonicalAlias("Barbell Press"));
    expect(canonicalAlias("Incline Press")).not.toBe(canonicalAlias("Decline Press"));
  });
  it("returns null for filler-only input", () => {
    expect(canonicalAlias("the and of")).toBeNull();
  });
});

describe("coreAlias", () => {
  it("strips equipment words", () => {
    expect(coreAlias("Bench Press (Barbell)")).toBe(coreAlias("Bench Press"));
    expect(coreAlias("Dumbbell Bench Press")).toBe(coreAlias("Barbell Bench Press"));
  });
  it("keeps position words", () => {
    expect(coreAlias("Incline Bench Press")).not.toBe(coreAlias("Bench Press"));
  });
  it("returns null when only equipment remains", () => {
    expect(coreAlias("Barbell")).toBeNull();
  });
});

describe("normalizeEquipment", () => {
  it("maps every upstream value", () => {
    expect(normalizeEquipment("body only")).toBe("bodyweight");
    expect(normalizeEquipment("e-z curl bar")).toBe("ez-curl-bar");
    expect(normalizeEquipment("kettlebells")).toBe("kettlebell");
    expect(normalizeEquipment("medicine ball")).toBe("medicine-ball");
    expect(normalizeEquipment("exercise ball")).toBe("exercise-ball");
    expect(normalizeEquipment("foam roll")).toBe("foam-roll");
    expect(normalizeEquipment("barbell")).toBe("barbell");
    expect(normalizeEquipment(null)).toBeNull();
    expect(normalizeEquipment("none")).toBeNull();
  });
});

describe("normalizeCategory", () => {
  it("maps strength-like categories to strength", () => {
    for (const raw of ["strength", "powerlifting", "olympic weightlifting", "strongman", "plyometrics"]) {
      expect(normalizeCategory(raw)).toBe("strength");
    }
  });
  it("maps stretching to mobility and cardio to cardio", () => {
    expect(normalizeCategory("stretching")).toBe("mobility");
    expect(normalizeCategory("cardio")).toBe("cardio");
  });
});

describe("normalizeMechanic", () => {
  it("maps isolated to isolation", () => {
    expect(normalizeMechanic("isolated")).toBe("isolation");
    expect(normalizeMechanic("compound")).toBe("compound");
    expect(normalizeMechanic(null)).toBeNull();
  });
});

describe("normalizeForce", () => {
  it("maps known forces and nulls the rest", () => {
    expect(normalizeForce("push")).toBe("push");
    expect(normalizeForce("pull")).toBe("pull");
    expect(normalizeForce("static")).toBe("static");
    expect(normalizeForce(null)).toBeNull();
    expect(normalizeForce("weird")).toBeNull();
  });
});

describe("inferTrackingType", () => {
  it("maps bodyweight strength to bodyweight_reps", () => {
    expect(inferTrackingType("strength", "bodyweight", "Push Up")).toBe("bodyweight_reps");
    expect(inferTrackingType("strength", null, "Bodyweight Squat")).toBe("bodyweight_reps");
  });
  it("detects assisted and weighted markers", () => {
    expect(inferTrackingType("strength", "bodyweight", "Assisted Pull Up")).toBe("bodyweight_assisted");
    expect(inferTrackingType("strength", "bodyweight", "Banded Push Up")).toBe("bodyweight_assisted");
    expect(inferTrackingType("strength", "bodyweight", "Weighted Push Up")).toBe("bodyweight_weighted");
  });
  it("maps loaded strength to weight_reps", () => {
    expect(inferTrackingType("strength", "barbell", "Barbell Squat")).toBe("weight_reps");
    expect(inferTrackingType("strength", "machine", "Machine Chest Press")).toBe("weight_reps");
  });
  it("maps mobility and cardio to duration", () => {
    expect(inferTrackingType("mobility", "bodyweight", "Hamstring Stretch")).toBe("duration");
    expect(inferTrackingType("cardio", null, "Running")).toBe("duration");
  });
});

describe("nameVariants", () => {
  it("strips a parenthetical qualifier", () => {
    expect(nameVariants("Bench Press (Barbell)")).toContain("Bench Press");
  });
  it("strips a leading equipment token", () => {
    expect(nameVariants("Barbell Bench Press")).toContain("bench press");
    expect(nameVariants("Dumbbell Bicep Curl")).toContain("bicep curl");
  });
  it("never returns the original name", () => {
    expect(nameVariants("Deadlift")).toHaveLength(0);
  });
});