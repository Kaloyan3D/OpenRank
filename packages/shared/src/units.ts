/**
 * Unit conversion helpers.
 *
 * OpenRank stores kilograms internally everywhere. Conversions exist only at
 * the edges (UI display, import/export) - never inside engines or storage.
 */

export type UnitSystem = "metric" | "imperial";

/** Exact pounds-per-kilogram definition: 1 lb = 0.45359237 kg. */
export const KG_PER_LB = 0.45359237;

/** Convert pounds to kilograms. */
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Convert kilograms to pounds. */
export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/**
 * Format a stored kilogram value for display in the given unit system.
 * Returns e.g. "102.5 kg" or "226.0 lb".
 */
export function formatWeight(
  kg: number,
  unit: UnitSystem,
  digits = 1,
): string {
  if (unit === "imperial") {
    return `${kgToLb(kg).toFixed(digits)} lb`;
  }
  return `${kg.toFixed(digits)} kg`;
}
