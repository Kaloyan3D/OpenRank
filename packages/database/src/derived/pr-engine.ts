/**
 * Pure personal-record engine (Phase 5, spec J/K).
 *
 * The PR layer computes candidate record values from a canonical set; it is
 * side-effect-free so the worker can use it both incrementally (against the
 * current best rows) and during a chronological rebuild (against running
 * bests) with identical results.
 *
 * e1RM is THE frozen ranking-core implementation (Epley, reps capped at 12)
 * - there is exactly one authoritative implementation in the codebase and
 * this layer reuses it (rule K).
 *
 * Record applicability per tracking type (documented in docs/DERIVED_STATE.md):
 *
 * | type                 | max_weight | max_e1rm | max_set_volume | max_reps_at_weight |
 * | weight_reps          | yes (ext)  | yes      | yes (ext×reps) | yes (per ext kg)   |
 * | bodyweight_weighted  | yes (added)| yes (eff)| yes (added×reps)| yes (per added kg) |
 * | bodyweight_assisted  | NO (assistance is regression)| yes (eff, needs bw)| NO | yes (per assistance kg) |
 * | bodyweight_reps      | NO         | NO (no external load; eff load comes only from the ranking engine's bodyweight fraction, not a strength PR) | NO | yes (w=0) |
 * | reps_only            | NO         | NO       | NO             | yes (w=0)          |
 * | duration             | NO         | NO       | NO             | NO                 |
 * | distance_duration    | NO         | NO       | NO             | NO                 |
 *
 * Semantics notes:
 * - max_weight is the highest EXTERNALLY ENTERED load: for
 *   bodyweight_weighted that is the ADDED weight (a true progression
 *   indicator); for bodyweight_assisted the entered value is assistance,
 *   where "more" is easier - recording it as a max-weight PR would be
 *   misleading, so it is excluded.
 * - max_set_volume = external load x reps (never bodyweight-inclusive
 *   work). For bodyweight_weighted this is documented as ADDED-load
 *   volume, not total work done.
 * - max_e1rm uses the ranking engine's EFFECTIVE load (external; bw+added;
 *   bw-assistance), so bodyweight-derived e1RM records require a resolved
 *   bodyweight and legitimately change when bodyweight history changes.
 * - Warmup, incomplete and invalid sets never produce candidates - the
 *   worker filters them before calling this layer.
 */

import { estimate1RM, effectiveLoad } from "@openrank/ranking-core";
import type { TrackingType, WorkoutSet } from "@openrank/domain";
import type { PersonalRecordType } from "@openrank/domain";
import { weightQualifierKey } from "./qualifier";

export interface PrCandidate {
  recordType: PersonalRecordType;
  qualifierKey: string;
  /** Canonical units: kg / kg (e1RM) / kg*reps / reps count. */
  value: number;
  sourceReps: number | null;
}

const REPS_EPSILON = 1e-9;

function validReps(reps: number | null | undefined): reps is number {
  return typeof reps === "number" && Number.isFinite(reps) && reps >= 1;
}

function validWeight(weightKg: number | null | undefined): weightKg is number {
  return typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0;
}

/** The tracking types whose external weight is progressive load (not assistance). */
export function usesProgressiveExternalWeight(trackingType: TrackingType): boolean {
  return trackingType === "weight_reps" || trackingType === "bodyweight_weighted";
}

/** True when max_reps_at_weight is applicable (reps tracked at a weight level). */
export function supportsRepsAtWeight(trackingType: TrackingType): boolean {
  return (
    trackingType === "weight_reps" ||
    trackingType === "bodyweight_weighted" ||
    trackingType === "bodyweight_assisted" ||
    trackingType === "bodyweight_reps" ||
    trackingType === "reps_only"
  );
}

/**
 * All PR candidates implied by one valid, completed, non-warmup set.
 * bodyweightKg may be null (no bodyweight recorded) - only records that do
 * not need it are produced then.
 */
export function prCandidatesForSet(
  trackingType: TrackingType,
  set: Pick<WorkoutSet, "weightKg" | "reps" | "setType">,
  bodyweightKg: number | null,
): PrCandidate[] {
  if (set.setType === "warmup") return [];
  const candidates: PrCandidate[] = [];

  // max_weight: externally entered progressive load.
  if (usesProgressiveExternalWeight(trackingType) && validWeight(set.weightKg)) {
    candidates.push({ recordType: "max_weight", qualifierKey: "", value: set.weightKg, sourceReps: null });
  }

  // max_e1rm: ranking-compatible e1RM over the EFFECTIVE load. For
  // bodyweight types a resolved bodyweight is REQUIRED - without it the
  // engine's bw-as-0 fallback would record an e1RM that silently jumps when
  // bodyweight history appears (spec: no fabricated normalization).
  if (validReps(set.reps)) {
    const needsBw = trackingType === "bodyweight_weighted" || trackingType === "bodyweight_assisted";
    const load = needsBw && bodyweightKg == null ? null : effectiveLoad(set.weightKg ?? null, trackingType, bodyweightKg);
    if (load != null && load > 0) {
      const e1rm = estimate1RM(load, set.reps);
      if (e1rm > 0) {
        candidates.push({ recordType: "max_e1rm", qualifierKey: "", value: e1rm, sourceReps: set.reps });
      }
    }
  }

  // max_set_volume: external load x reps (bodyweight-exclusive by design).
  if (usesProgressiveExternalWeight(trackingType) && validWeight(set.weightKg) && validReps(set.reps)) {
    candidates.push({
      recordType: "max_set_volume",
      qualifierKey: "",
      value: set.weightKg * set.reps,
      sourceReps: set.reps,
    });
  }

  // max_reps_at_weight: more reps at the SAME normalized external weight.
  // Assistance level counts as the weight level for bodyweight_assisted
  // (more reps at equal assistance is a real improvement; documented).
  if (supportsRepsAtWeight(trackingType) && validReps(set.reps)) {
    if (trackingType === "bodyweight_reps" || trackingType === "reps_only") {
      candidates.push({ recordType: "max_reps_at_weight", qualifierKey: weightQualifierKey(null), value: set.reps, sourceReps: set.reps });
    } else {
      const w = set.weightKg;
      // External progressive load (weight_reps/bodyweight_weighted): any
      // non-negative entered weight is a qualifier level (0 = no added
      // load). Assistance (bodyweight_assisted): the entered level too.
      if (w != null && Number.isFinite(w) && w >= 0) {
        candidates.push({ recordType: "max_reps_at_weight", qualifierKey: weightQualifierKey(w), value: set.reps, sourceReps: set.reps });
      }
    }
  }

  return candidates;
}

/** Strictly-better comparison: an equal repeat is never a new PR. */
export function isImprovement(candidateValue: number, currentBest: number | null): boolean {
  return currentBest == null || candidateValue > currentBest + REPS_EPSILON;
}