/**
 * Next-tier recommendation - faithful port of the legacy engine.
 */
import { COMPOSITE_WEIGHTS } from "./constants.js";
import { weightForReps } from "./math.js";
import type { GroupResult, NextTierRecommendation } from "./types.js";

/**
 * Compute an actionable "how to reach the next tier" recommendation for a
 * group, by figuring out how much heavier the user's top compound would need
 * to be if pushed alone (other composite contributors held constant).
 *
 * Returns null when there's no meaningful next step (already at top tier,
 * no bodyweight, no compound lift, capped fallback tier, etc.).
 */
export function nextTierRecommendation(
  group: GroupResult | null | undefined,
  opts: { bodyweightKg?: number | null } = {},
): NextTierRecommendation | null {
  if (!group || !group.hasData || !group.used?.length) return null;
  if (!group.next?.tier) return null; // already at Mythic
  if (group.capped) return null; // fallback tier; different advice needed

  const bw = Number(opts.bodyweightKg ?? group.bodyweightKg);
  if (!Number.isFinite(bw) || bw <= 0) return null;

  const top = group.used[0];
  if (!top || !top.coeff || !top.best1RM) return null;

  const weights = COMPOSITE_WEIGHTS.slice(0, group.used.length);
  const sumW = weights.reduce((a, b) => a + b, 0);
  // Contribution of lifts 2..N to the composite numerator (held constant).
  let heldSum = 0;
  for (let i = 1; i < group.used.length; i++) {
    heldSum += (weights[i] ?? 0) * (group.used[i]?.eqRatio ?? 0);
  }
  // targetComposite * sumW = w0 * newRatio0 + heldSum
  //   => newRatio0 = (targetComposite * sumW - heldSum) / w0
  const targetComposite = group.next.ratio;
  const newRatio0 = (targetComposite * sumW - heldSum) / (weights[0] ?? 1);
  const required1RM = newRatio0 * top.coeff * bw;
  const delta1RM = required1RM - top.best1RM;

  // Pick a rep target close to the user's actual best-set rep count so the
  // recommendation feels concrete (defaults to 5 reps if none available).
  const reps = Math.max(1, Math.min(10, Math.round(top.reps || 5)));

  return {
    nextTier: group.next.tier,
    topLift: {
      title: top.title,
      best1RM: top.best1RM,
      coeff: top.coeff,
      currentReps: top.reps,
    },
    required1RM,
    delta1RM,
    targetForReps: { reps, weight: weightForReps(required1RM, reps) },
    currentForReps: { reps, weight: weightForReps(top.best1RM, reps) },
    tooFar: delta1RM > top.best1RM * 0.3,
  };
}
