import { describe, expect, it } from "vitest";
import { validateSetForCompletion, validateSetInput } from "./set-validation";

const base = {
  weightKg: null,
  reps: null,
  durationSeconds: null,
  distanceMeters: null,
  rpe: null,
  rir: null,
};

describe("set validation (edit time)", () => {
  it("allows partial/empty values while editing", () => {
    expect(() => validateSetInput("weight_reps", {})).not.toThrow();
    expect(() => validateSetInput("weight_reps", { weightKg: null, reps: null })).not.toThrow();
  });

  it("rejects impossible numbers", () => {
    expect(() => validateSetInput("weight_reps", { weightKg: -1 })).toThrow(/negative/);
    expect(() => validateSetInput("weight_reps", { weightKg: Number.NaN })).toThrow(/finite/);
    expect(() => validateSetInput("weight_reps", { weightKg: Number.POSITIVE_INFINITY })).toThrow(/finite/);
    expect(() => validateSetInput("bodyweight_reps", { reps: -2 })).toThrow(/negative/);
    expect(() => validateSetInput("bodyweight_reps", { reps: 2.5 })).toThrow(/whole/);
    expect(() => validateSetInput("duration", { durationSeconds: -10 })).toThrow(/negative/);
    expect(() => validateSetInput("distance_duration", { distanceMeters: -1 })).toThrow(/negative/);
  });

  it("allows realistic decimal weights", () => {
    expect(() => validateSetInput("weight_reps", { weightKg: 102.5 })).not.toThrow();
    expect(() => validateSetInput("weight_reps", { weightKg: 0 })).not.toThrow();
  });

  it("bounds RPE and RIR", () => {
    expect(() => validateSetInput("weight_reps", { rpe: 0 })).toThrow(/RPE/);
    expect(() => validateSetInput("weight_reps", { rpe: 10.5 })).toThrow(/RPE/);
    expect(() => validateSetInput("weight_reps", { rpe: 8.5 })).not.toThrow(); // fractional RPE is standard
    expect(() => validateSetInput("weight_reps", { rir: -1 })).toThrow(/RIR/);
    expect(() => validateSetInput("weight_reps", { rir: 11 })).toThrow(/RIR/);
    expect(() => validateSetInput("weight_reps", { rir: 3 })).not.toThrow();
  });
});

describe("set validation (completion time, per tracking type)", () => {
  it("weight_reps requires weight + reps", () => {
    expect(() =>
      validateSetForCompletion("weight_reps", { ...base, weightKg: 100, reps: 5 }),
    ).not.toThrow();
    expect(() => validateSetForCompletion("weight_reps", { ...base, reps: 5 })).toThrow(/weight/);
    expect(() => validateSetForCompletion("weight_reps", { ...base, weightKg: 100 })).toThrow(/reps/);
    expect(() =>
      validateSetForCompletion("weight_reps", { ...base, weightKg: 100, reps: 0 }),
    ).toThrow(/reps/);
    expect(() =>
      validateSetForCompletion("weight_reps", { ...base, weightKg: 102.5, reps: 3 }),
    ).not.toThrow();
  });

  it("bodyweight_reps requires reps only", () => {
    expect(() => validateSetForCompletion("bodyweight_reps", { ...base, reps: 8 })).not.toThrow();
    expect(() => validateSetForCompletion("bodyweight_reps", { ...base })).toThrow(/reps/);
    expect(() =>
      validateSetForCompletion("bodyweight_reps", { ...base, weightKg: 5, reps: 8 }),
    ).not.toThrow(); // harmless extra field
  });

  it("bodyweight_weighted requires added weight + reps (0 kg allowed)", () => {
    expect(() =>
      validateSetForCompletion("bodyweight_weighted", { ...base, weightKg: 20, reps: 5 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("bodyweight_weighted", { ...base, weightKg: 0, reps: 5 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("bodyweight_weighted", { ...base, reps: 5 }),
    ).toThrow(/added weight/);
  });

  it("bodyweight_assisted requires assistance weight + reps (0 kg allowed)", () => {
    expect(() =>
      validateSetForCompletion("bodyweight_assisted", { ...base, weightKg: 25, reps: 6 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("bodyweight_assisted", { ...base, weightKg: 0, reps: 6 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("bodyweight_assisted", { ...base, reps: 6 }),
    ).toThrow(/assistance weight/);
  });

  it("reps_only requires reps", () => {
    expect(() => validateSetForCompletion("reps_only", { ...base, reps: 12 })).not.toThrow();
    expect(() => validateSetForCompletion("reps_only", { ...base, weightKg: 10 })).toThrow(/reps/);
  });

  it("duration requires positive duration", () => {
    expect(() =>
      validateSetForCompletion("duration", { ...base, durationSeconds: 3600 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("duration", { ...base, durationSeconds: 0 }),
    ).toThrow(/duration/);
    expect(() => validateSetForCompletion("duration", { ...base, reps: 10 })).toThrow(/duration/);
  });

  it("distance_duration requires distance + duration", () => {
    expect(() =>
      validateSetForCompletion("distance_duration", { ...base, distanceMeters: 5000, durationSeconds: 1500 }),
    ).not.toThrow();
    expect(() =>
      validateSetForCompletion("distance_duration", { ...base, distanceMeters: 5000 }),
    ).toThrow(/duration/);
    expect(() =>
      validateSetForCompletion("distance_duration", { ...base, durationSeconds: 600 }),
    ).toThrow(/distance/);
  });

  it("never blocks on missing RPE/RIR", () => {
    expect(() =>
      validateSetForCompletion("weight_reps", { ...base, weightKg: 60, reps: 8 }),
    ).not.toThrow();
  });
});