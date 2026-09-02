/**
 * Notification time helpers (Phase 7, spec F/AI).
 *
 * Reminder times are LOCAL WALL-CLOCK times bound to the session's logical
 * training date. The mapping to OS instants happens exactly once, here:
 *
 *   local wall (D, minutes)  ->  UTC instant
 *
 * with the logical-day rule: minutes < dayBoundary (04:00) belong to the
 * NEXT calendar day's wall clock (Monday 01:00 is really Tuesday 01:00 on
 * Monday's logical training day).
 *
 * Calendar math stays on date strings (DST-immune, spec AI): no
 * "previous reminder + 24 hours" anywhere.
 */

import { addDays } from "../iso-week";

/** Default logical-day boundary (04:00 local) - mirrors the schedule engine. */
const DAY_BOUNDARY_MINUTES = 240;

/**
 * The UTC instant at which the local wall clock reads `minutes` past
 * midnight on local calendar date `date`.
 */
export function localWallInstant(date: string, minutes: number, offsetMinutes: number): string {
  const utcMidnight = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(utcMidnight)) throw new Error("invalid date string: " + date);
  return new Date(utcMidnight - offsetMinutes * 60_000 + minutes * 60_000).toISOString();
}

/**
 * Reminder instant for a scheduled session (spec F): the user-chosen local
 * wall time interpreted on the session's logical training day.
 */
export function reminderInstant(
  scheduledDate: string,
  reminderMinutesAfterMidnight: number,
  offsetMinutes: number,
  dayBoundaryMinutes: number = DAY_BOUNDARY_MINUTES,
): string {
  if (!Number.isInteger(reminderMinutesAfterMidnight) || reminderMinutesAfterMidnight < 0 || reminderMinutesAfterMidnight > 1439) {
    throw new Error("reminder minutes out of range: " + String(reminderMinutesAfterMidnight));
  }
  // Early-morning times (00:00-03:59) belong to the FOLLOWING calendar day
  // (Tuesday 01:00 still belongs to Monday's logical training day).
  const wallDate = reminderMinutesAfterMidnight < dayBoundaryMinutes ? addDays(scheduledDate, 1) : scheduledDate;
  return localWallInstant(wallDate, reminderMinutesAfterMidnight, offsetMinutes);
}

/**
 * The instant the session's logical training day ENDS: local (D+1) 04:00.
 * Secondary reminders must occur strictly before this (spec O).
 */
export function logicalDayEndInstant(
  scheduledDate: string,
  offsetMinutes: number,
  dayBoundaryMinutes: number = DAY_BOUNDARY_MINUTES,
): string {
  return localWallInstant(addDays(scheduledDate, 1), dayBoundaryMinutes, offsetMinutes);
}
