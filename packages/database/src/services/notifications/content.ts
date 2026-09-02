/**
 * Notification copy (Phase 7, specs L/N/M/Y).
 *
 * Personalities change TONE, never facts. Deliberate rules:
 * - NO numeric streak counts in scheduled OS copy (spec M): the value may be
 *   stale by delivery time. Stable phrases only; the Home screen owns live
 *   numbers.
 * - No insults, body shaming, guilt around rest, fake urgency, medical
 *   claims or manipulation (spec Y).
 * - Copy is short enough for OS notification trays.
 */

import type { ReminderStyle } from "@openrank/domain";

export interface NotificationContent {
  title: string;
  body: string;
}

const PRIMARY: Record<ReminderStyle, { title: string; body: string; bodyWithRoutine: string }> = {
  gentle: {
    title: "Training is on your plan today",
    body: "Time for your planned session when you're ready.",
    bodyWithRoutine: "{routine} is on your plan today. Whenever you're ready.",
  },
  normal: {
    title: "Training day",
    body: "Your planned workout is waiting.",
    bodyWithRoutine: "{routine} is on your plan today.",
  },
  competitive: {
    title: "Training day",
    body: "Diamond doesn't earn itself. Training is on your plan today.",
    bodyWithRoutine: "Diamond doesn't earn itself. {routine} is on your plan today.",
  },
};

const SECONDARY: Record<ReminderStyle, { title: string; body: string }> = {
  gentle: {
    title: "Still open today",
    body: "Your planned workout is still open today.",
  },
  normal: {
    title: "Still open today",
    body: "Your planned workout is still open today.",
  },
  competitive: {
    title: "Still time",
    body: "Still time to get today's training done.",
  },
};

/** Primary training reminder. Stable copy; the routine name is safe context. */
export function primaryReminderContent(style: ReminderStyle, routineName: string | null): NotificationContent {
  const base = PRIMARY[style];
  return {
    title: base.title,
    body: routineName ? base.bodyWithRoutine.replace("{routine}", routineName) : base.body,
  };
}

/** Optional secondary reminder (max one per session, spec N). */
export function secondaryReminderContent(style: ReminderStyle): NotificationContent {
  return { ...SECONDARY[style] };
}

/** Rest-complete notification (spec Z). Neutral, no performance framing. */
export function restTimerContent(): NotificationContent {
  return { title: "Rest complete", body: "Time for your next set." };
}
