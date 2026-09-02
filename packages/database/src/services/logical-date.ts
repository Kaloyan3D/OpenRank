/**
 * Logical training day (centralized helper, Phase 4).
 *
 * The boundary between two training days is 04:00 local time: a session that
 * starts at 01:30 local belongs to the *previous* calendar day. Phase 6
 * (scheduled streaks) reuses exactly this helper - do not duplicate the
 * logic anywhere else.
 */

/** Local day boundary: 04:00 (minutes from local midnight). */
export const LOGICAL_DAY_BOUNDARY_MINUTES = 4 * 60;

/** Local calendar date (YYYY-MM-DD) at the start instant. */
export function computeStartLocalDate(startedAtUtc: string, offsetMinutes: number): string {
  return localDateAt(startedAtUtc, offsetMinutes, false);
}

/**
 * Logical training date (YYYY-MM-DD): the local calendar date, shifted one
 * day back when the start instant falls before 04:00 local.
 */
export function computeLogicalTrainingDate(startedAtUtc: string, offsetMinutes: number): string {
  return localDateAt(startedAtUtc, offsetMinutes, true);
}

function localDateAt(startedAtUtc: string, offsetMinutes: number, applyBoundary: boolean): string {
  if (!Number.isFinite(offsetMinutes)) throw new Error("timezone offset must be finite");
  const ms = Date.parse(startedAtUtc);
  if (Number.isNaN(ms)) throw new Error("invalid ISO-8601 instant: " + startedAtUtc);
  // Work in the local wall clock by shifting the instant, then reading UTC
  // components (keeps the helper deterministic and timezone-independent).
  const local = new Date(ms + offsetMinutes * 60_000);
  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  if (applyBoundary && minutesOfDay < LOGICAL_DAY_BOUNDARY_MINUTES) {
    day -= 86_400_000;
  }
  return new Date(day).toISOString().slice(0, 10);
}
