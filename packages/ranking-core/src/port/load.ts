/**
 * Effective load resolution - faithful port of the legacy engine.
 */

/**
 * Effective load of a set depending on the tracking type.
 * Returns null when the set carries no measurable load.
 */
export function effectiveLoad(
  weightKg: unknown,
  type: string | null | undefined,
  bodyweightKg: number | null | undefined,
): number | null {
  const w = Number(weightKg);
  const bw = Number(bodyweightKg) || 0;
  const hasW = Number.isFinite(w) && w > 0;
  switch (type) {
    case "weight_reps":
    case "short_distance_weight":
      return hasW ? w : null;
    case "bodyweight_weighted":
      return bw + (hasW ? w : 0);
    case "bodyweight_assisted": {
      // Effective load = bodyweight minus assistance. Skip the set when
      // assistance meets or exceeds bodyweight (nothing to normalize).
      const eff = bw - (hasW ? w : 0);
      return eff > 0 ? eff : null;
    }
    default:
      // reps_only, duration, distance_duration, etc.: no measurable load
      return null;
  }
}
