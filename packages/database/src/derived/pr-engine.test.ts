import { describe, expect, it } from "vitest";
import { isImprovement, prCandidatesForSet } from "./pr-engine";
import { estimate1RM } from "@openrank/ranking-core";

import type { WorkoutSet } from "@openrank/domain";
type SetType = WorkoutSet["setType"];
const set = (weightKg: number | null, reps: number | null, setType: SetType = "normal") => ({ weightKg, reps, setType });

describe("PR candidates per tracking type (applicability matrix)", () => {
  it("weight_reps produces all four record types", () => {
    const c = prCandidatesForSet("weight_reps", set(100, 5), 80);
    const types = c.map((x) => x.recordType).sort();
    expect(types).toEqual(["max_e1rm", "max_reps_at_weight", "max_set_volume", "max_weight"]);
    expect(c.find((x) => x.recordType === "max_weight")!.value).toBe(100);
    expect(c.find((x) => x.recordType === "max_set_volume")!.value).toBe(500);
    expect(c.find((x) => x.recordType === "max_e1rm")!.value).toBeCloseTo(estimate1RM(100, 5), 10);
    expect(c.find((x) => x.recordType === "max_reps_at_weight")!.qualifierKey).toBe("w=100");
    expect(c.find((x) => x.recordType === "max_reps_at_weight")!.value).toBe(5);
  });

  it("bodyweight_weighted: max_weight is the ADDED weight; e1rm uses effective load", () => {
    const c = prCandidatesForSet("bodyweight_weighted", set(20, 8), 80);
    const mw = c.find((x) => x.recordType === "max_weight")!;
    expect(mw.value).toBe(20); // added external load, documented
    const e = c.find((x) => x.recordType === "max_e1rm")!;
    expect(e.value).toBeCloseTo(estimate1RM(100, 8), 10); // bw 80 + added 20
    const vol = c.find((x) => x.recordType === "max_set_volume")!;
    expect(vol.value).toBe(20 * 8); // added-load volume, documented
    const rw = c.find((x) => x.recordType === "max_reps_at_weight")!;
    expect(rw.qualifierKey).toBe("w=20");
  });

  it("bodyweight_assisted: no max_weight / no set-volume; e1rm uses bw - assistance", () => {
    const c = prCandidatesForSet("bodyweight_assisted", set(15, 10), 80);
    expect(c.find((x) => x.recordType === "max_weight")).toBeUndefined();
    expect(c.find((x) => x.recordType === "max_set_volume")).toBeUndefined();
    const e = c.find((x) => x.recordType === "max_e1rm")!;
    expect(e.value).toBeCloseTo(estimate1RM(65, 10), 10);
    const rw = c.find((x) => x.recordType === "max_reps_at_weight")!;
    expect(rw.qualifierKey).toBe("w=15"); // keyed by assistance level
  });

  it("bodyweight_reps and reps_only: only max_reps_at_weight at w=0", () => {
    for (const type of ["bodyweight_reps", "reps_only"] as const) {
      const c = prCandidatesForSet(type, set(null, 12), 80);
      expect(c).toHaveLength(1);
      expect(c[0]!.recordType).toBe("max_reps_at_weight");
      expect(c[0]!.qualifierKey).toBe("w=0");
      expect(c[0]!.value).toBe(12);
    }
  });

  it("duration types produce no PRs in Phase 5", () => {
    expect(prCandidatesForSet("duration", { weightKg: null, reps: null, setType: "normal" }, 80)).toEqual([]);
    expect(prCandidatesForSet("distance_duration", { weightKg: null, reps: null, setType: "normal" }, 80)).toEqual([]);
  });

  it("missing bodyweight disables e1rm for bodyweight types but keeps absolute records", () => {
    const weighted = prCandidatesForSet("bodyweight_weighted", set(20, 8), null);
    expect(weighted.map((x) => x.recordType).sort()).toEqual(["max_reps_at_weight", "max_set_volume", "max_weight"]);
    const assisted = prCandidatesForSet("bodyweight_assisted", set(15, 10), null);
    expect(assisted.map((x) => x.recordType)).toEqual(["max_reps_at_weight"]);
  });
});

describe("set validity filtering", () => {
  it("warmup sets never produce candidates", () => {
    expect(prCandidatesForSet("weight_reps", set(100, 5, "warmup"), 80)).toEqual([]);
  });

  it("zero weight produces no max_weight/volume but reps-at-weight at 0 stays valid", () => {
    const c = prCandidatesForSet("weight_reps", set(0, 10), 80);
    expect(c.find((x) => x.recordType === "max_weight")).toBeUndefined();
    expect(c.find((x) => x.recordType === "max_set_volume")).toBeUndefined();
    expect(c.find((x) => x.recordType === "max_reps_at_weight")!.qualifierKey).toBe("w=0");
  });

  it("invalid reps suppress reps-based records but max_weight remains weight-only", () => {
    expect(prCandidatesForSet("weight_reps", set(100, 0), 80).map((c) => c.recordType)).toEqual(["max_weight"]);
    expect(prCandidatesForSet("weight_reps", set(100, null), 80).map((c) => c.recordType)).toEqual(["max_weight"]);
  });
});

describe("strictly-greater semantics", () => {
  it("equal repeats are not improvements; marginally greater are", () => {
    expect(isImprovement(100, null)).toBe(true); // first record
    expect(isImprovement(100, 100)).toBe(false);
    expect(isImprovement(100.5, 100)).toBe(true);
    expect(isImprovement(99.9, 100)).toBe(false);
    // float noise does not count as an improvement
    expect(isImprovement(100 + 1e-12, 100)).toBe(false);
  });
});