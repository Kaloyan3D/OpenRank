/**
 * Progress range chips (Phase 8.1, spec 33): pure mapping from the user
 * facing range to the AnalyticsService week count. 4W=4, 12W=12, 6M=26,
 * 1Y=52, ALL=260 (five years of ISO weeks - the service caps gracefully).
 */

export const RANGE_OPTIONS = ["4W", "12W", "6M", "1Y", "ALL"] as const;
export type ProgressRange = (typeof RANGE_OPTIONS)[number];

export function rangeToWeeks(range: ProgressRange): number {
  switch (range) {
    case "4W":
      return 4;
    case "12W":
      return 12;
    case "6M":
      return 26;
    case "1Y":
      return 52;
    case "ALL":
      return 260;
  }
}

/** ISO week start (Monday, UTC midnight) this many weeks back. */
export function rangeStartIso(range: ProgressRange, now = new Date()): string {
  const weeks = rangeToWeeks(range);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day - (weeks - 1) * 7);
  return d.toISOString().slice(0, 10);
}
