/**
 * Ranking math - faithful port of the legacy engine.
 */
import { COMPOSITE_WEIGHTS } from "./constants.js";
import { deburr } from "./text.js";
import type { Lift } from "./types.js";

/** 1RM estimation (Epley formula), reps capped at 12 to stay realistic. */
export function estimate1RM(load: unknown, reps: unknown): number {
  const w = Number(load);
  const r = Math.min(Number(reps), 12);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

/**
 * Reverse Epley: for a given target 1RM, weight that should be liftable for
 * `reps` reps. Used to translate 1RM targets into actionable
 * "hit X kg x N reps" recommendations.
 */
export function weightForReps(oneRm: unknown, reps: unknown): number {
  const one = Number(oneRm);
  const r = Number(reps);
  if (!Number.isFinite(one) || !Number.isFinite(r) || one <= 0 || r <= 0) {
    return 0;
  }
  if (r === 1) return one;
  return one / (1 + r / 30);
}

export function sexFactor(sex: string | null | undefined): number {
  return String(sex).toLowerCase().startsWith("f") ? 0.72 : 1;
}

/** On machines/cables you can load more, so higher coeff => fairer rank. */
export function equipFactor(equipment: string | null | undefined): number {
  switch (equipment) {
    case "machine":
      return 1.5;
    case "cable":
      return 1.3;
    case "smith_machine":
    case "smith":
      return 1.35;
    default:
      return 1;
  }
}

/**
 * Fraction of bodyweight effectively lifted on a pure bodyweight movement
 * (reps_only, no external load), so it can still be scored.
 */
export function bodyweightFraction(title: string, groupKey: string): number {
  const t = deburr(title);
  if (/(pull up|pull-up|pullup|chin|traction|dominada|klimmzug|barra fixa|trazion|muscle up)/.test(t)) return 0.6;
  if (/(pistol|squat|sentadilla|kniebeuge|agachamento)/.test(t)) return 0.5;
  if (/(push up|pushup|push-up|pompe|flexion|liegestutz|flessione|flexao)/.test(t)) return 0.35;
  if (/(dip)/.test(t)) return 0.45;
  if (groupKey === "core") return 0.25;
  return 0.4;
}


/** Reference 1RM/BW equivalent -> tier index (0..8). */
export function ratioToTierIndex(
  ratio: number,
  thresholds: number[],
  factor: number,
): number {
  let idx = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (ratio >= (thresholds[i] ?? 0) * factor) idx = i;
  }
  return idx;
}

/**
 * Aggregates eqRatios into a composite score (weighted average of top N).
 * If fewer than N lifts, only the corresponding weights are used.
 */
export function compositeRatio(
  lifts: readonly Lift[],
  weights: readonly number[] = COMPOSITE_WEIGHTS,
): number | null {
  const top = lifts.slice(0, weights.length);
  if (top.length === 0) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < top.length; i++) {
    if (top[i]?.eqRatio == null) continue;
    num += (top[i]?.eqRatio ?? 0) * (weights[i] ?? 0);
    den += weights[i] ?? 0;
  }
  return den > 0 ? num / den : null;
}