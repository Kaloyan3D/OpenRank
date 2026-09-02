/**
 * Deterministic weight qualifier identity for max_reps_at_weight records
 * (Phase 5, spec J/B).
 *
 * Raw floating-point strings are NOT stable identities (binary rounding
 * noise from unit conversion, e.g. 225 lb -> 102.05828325000000... kg).
 * Normalization chosen:
 *
 *   qualifier = "w=" + String(Math.round(weightKg * 10000) / 10000)
 *
 * i.e. canonical kilograms rounded to 4 decimal places (0.1 mg precision -
 * far below any sensible load increment) rendered through JS number
 * toString(), which is the deterministic shortest round-trip form for a
 * given double. Two entered loads that round to the same 4-decimal value
 * are the same qualifier; conversion noise cannot split one weight in two.
 * Pure bodyweight sets (external weight NULL) normalize to "w=0".
 */

export function weightQualifierKey(weightKg: number | null | undefined): string {
  if (weightKg == null || !Number.isFinite(weightKg)) return "w=0";
  const rounded = Math.round(weightKg * 10000) / 10000;
  // Normalize -0 and keep integers compact ("w=100" not "w=100.0000").
  const n = rounded === 0 ? 0 : rounded;
  return "w=" + String(n);
}
