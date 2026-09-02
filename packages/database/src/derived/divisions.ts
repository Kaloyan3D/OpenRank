/**
 * Division semantics (Phase 5, spec N) + projection versioning.
 *
 * Divisions are an application-level (UI/data) representation of progress
 * WITHIN a tier; they never change strength formulas or thresholds. The
 * frozen engine stays "hevy-ranks-compatible-v1"; everything OpenRank adds
 * on top (eligibility gating, divisions, snapshot/event projections) is
 * versioned separately as PROJECTION_VERSION so historical snapshots retain
 * honest provenance.
 */

import { RANK_TIERS } from "@openrank/ranking-core";

/** The frozen compatibility engine (unchanged in Phase 5). */
export const ENGINE_VERSION = "hevy-ranks-compatible-v1";

/**
 * Application-level projection wrapper: eligibility gating, provisional
 * policy, division representation, snapshot/event persistence.
 * Bump ONLY with a documented behavior change + fresh rebuild.
 */
export const PROJECTION_VERSION = "openrank-ranking-projection-v1";

export type Division = "IV" | "III" | "II" | "I";

/**
 * Division for a within-tier progress fraction:
 *   0% <= p < 25%  -> IV
 *  25% <= p < 50%  -> III
 *  50% <= p < 75%  -> II
 *  75% <= p <= 100% -> I
 * Boundaries are exact (tested). Mythic (top tier) has no next threshold:
 * division is null and the UI shows the tier alone.
 */
export function divisionForProgress(progress: number | null, tierIndex: number, topTierIndex: number): Division | null {
  if (tierIndex >= topTierIndex) return null;
  if (progress == null || !Number.isFinite(progress)) return "IV";
  // Quantize to 9 decimals so binary float noise (0.7-0.6)/0.2 cannot flip
  // an exact boundary (0.5 -> III instead of II). Deterministic and stable.
  const p = Math.min(1, Math.max(0, Math.round(progress * 1e9) / 1e9));
  if (p < 0.25) return "IV";
  if (p < 0.5) return "III";
  if (p < 0.75) return "II";
  return "I";
}

export function tierName(tierIndex: number): string {
  const tier = RANK_TIERS[tierIndex];
  return tier ? tier.name : "Bronze";
}

/** Index of the Mythic (top) tier. */
export const TOP_TIER_INDEX = RANK_TIERS.length - 1;

/**
 * Progress within the current tier, mirrored from the engine's definition:
 * (score - currentThreshold) / (nextThreshold - currentThreshold), clamped
 * only for representation safety. Mythic (no next threshold) -> null.
 */
export function progressWithinTier(
  score: number,
  tierIndex: number,
  thresholds: readonly number[],
  sexFactorValue: number,
): number | null {
  if (tierIndex >= TOP_TIER_INDEX) return null;
  const cur = (thresholds[tierIndex] ?? 0) * sexFactorValue;
  const next = (thresholds[tierIndex + 1] ?? 0) * sexFactorValue;
  const span = next - cur;
  if (span <= 0) return 1;
  const raw = (score - cur) / span;
  return Math.min(1, Math.max(0, Math.round(raw * 1e9) / 1e9));
}

/** Score equality with a deterministic float tolerance. */
export function sameScore(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}