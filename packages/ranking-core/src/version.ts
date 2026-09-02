/**
 * Compatibility identifier stamped on every ranking calculation.
 *
 * Policy (docs/RANKING_SPEC.md): never silently change coefficients,
 * thresholds, weighting, the e1RM formula, caps, or sex multiplier behavior.
 * Any intentional behavior change requires a new ranking version id.
 */
export const RANKING_VERSION = "hevy-ranks-compatible-v1" as const;
