/**
 * Calendar-date helpers for the schedule engine (Phase 6).
 *
 * All functions operate on local calendar date STRINGS (YYYY-MM-DD) using
 * UTC-midnight arithmetic. No instants, no "24 hours since X" math - Monday
 * remains Monday across DST by construction (spec AN); the only instant
 * mapping (logical training day) lives in ./logical-date.
 */

export function isoWeekdayOf(dateStr: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const ms = Date.parse(dateStr + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new Error("invalid date string: " + dateStr);
  const jsDay = new Date(ms).getUTCDay(); // 0 = Sunday
  return (jsDay === 0 ? 7 : jsDay) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function addDays(dateStr: string, days: number): string {
  const ms = Date.parse(dateStr + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new Error("invalid date string: " + dateStr);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing the date. */
export function startOfIsoWeek(dateStr: string): string {
  return addDays(dateStr, -(isoWeekdayOf(dateStr) - 1));
}

export function datesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * ISO-8601 week key ("YYYY-Www", week-numbering year). Weeks start Monday;
 * week 1 contains the first Thursday of the year.
 */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(Date.parse(dateStr + "T00:00:00.000Z"));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const week = Math.floor((d.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return String(isoYear) + "-W" + String(week).padStart(2, "0");
}
