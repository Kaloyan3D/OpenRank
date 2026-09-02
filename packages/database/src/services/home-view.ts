/**
 * Home next-action policy (Phase 7.1, spec: never silently reinterpret a
 * future obligation). Pure + deterministic so the decision is testable
 * without React.
 *
 * - TODAY with a pending planned session -> the obligation can be started.
 * - TODAY completed / missed -> reported honestly (no start-as-planned CTA).
 * - NEXT obligation in the future -> "future": the UI must NOT offer a CTA
 *   that implies starting it satisfies today; it offers the plan + an
 *   explicit BONUS choice. Early planned training requires an explicit
 *   ScheduleService.rescheduleSession to today first.
 * - Manual workouts on any other day remain BONUS workouts (streak counts
 *   planned sessions only - Phase 6 semantics untouched).
 */

export type WeekDayStateName =
  | "rest"
  | "planned"
  | "completed"
  | "missed"
  | "paused"
  | "rescheduled";

export type HomeSessionView =
  | { kind: "today_planned"; sessionId: string }
  | { kind: "today_completed" }
  | { kind: "today_missed" }
  | { kind: "future"; sessionId: string; scheduledDate: string }
  | { kind: "none" };

export interface HomeSessionInput {
  todayLogical: string;
  todaysState: WeekDayStateName;
  next: { id: string; scheduledDate: string } | null;
}

export function resolveHomeSessionView(input: HomeSessionInput): HomeSessionView {
  const { todayLogical, todaysState, next } = input;
  const nextIsToday = next != null && next.scheduledDate === todayLogical;
  if (todaysState === "planned") {
    // The pending obligation for today (its id is the next pending session
    // on today's date).
    if (nextIsToday) return { kind: "today_planned", sessionId: next!.id };
    // Defensive: the week state says planned but no pending session exists
    // (should not happen) - report none rather than a wrong CTA.
    return { kind: "none" };
  }
  if (todaysState === "completed") return { kind: "today_completed" };
  if (todaysState === "missed") return { kind: "today_missed" };
  if (next == null) return { kind: "none" };
  if (nextIsToday) return { kind: "today_planned", sessionId: next.id };
  return { kind: "future", sessionId: next.id, scheduledDate: next.scheduledDate };
}
