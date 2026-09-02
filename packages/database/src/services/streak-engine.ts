/**
 * Pure streak computation (Phase 6, spec O/P/Q/AB).
 *
 * Deterministic function over the scheduled-session ledger: no clock reads,
 * no repository access. Both incremental processing and full rebuild run
 * exactly this function, which is what makes incremental == rebuild.
 */

import type { ScheduledSession, StreakEvent, StreakEventType } from "@openrank/domain";
import { isoWeekKey } from "./iso-week";

export const STREAK_MILESTONES: readonly number[] = [5, 10, 25, 50, 100, 250, 500];

export interface SessionStreakMark {
  sessionId: string;
  streakAfter: number;
}

export interface StreakComputation {
  currentStreak: number;
  bestStreak: number;
  perfectWeeks: number;
  lastCompletedSessionId: string | null;
  /** Current streak value (= completed sessions since the last miss/reset). */
  completedSinceLastMiss: number;
  /** scheduled_date of the most recent missed obligation, if any. */
  lastMissedSessionDate: string | null;
  /** Per-completed-session running streak (read model, idempotent writes). */
  sessionStreaks: SessionStreakMark[];
  /** Stable-identity events to append (INSERT OR IGNORE upstream). */
  events: Array<Omit<StreakEvent, "id" | "profileId" | "createdAt">>;
  /** ISO week keys of finalized perfect weeks (debug/audit). */
  perfectWeekKeys: string[];
}

/**
 * Walk the ledger chronologically:
 * - completed  -> streak + 1 (milestone events at stable crossing points)
 * - missed     -> streak reset to 0 (+ broken event)
 * - paused / rescheduled / cancelled -> neutral (no increment, no reset)
 * - pending    -> open future obligation: stops current-streak evaluation
 *                 (never treated as a miss); week finality flags remain.
 */
export function computeStreakState(sessions: readonly ScheduledSession[], nowTs: string): StreakComputation {
  const ordered = [...sessions].sort((a, b) =>
    a.scheduledDate === b.scheduledDate ? (a.id < b.id ? -1 : 1) : a.scheduledDate < b.scheduledDate ? -1 : 1,
  );

  let current = 0;
  let best = 0;
  let lastCompletedSessionId: string | null = null;
  let lastMissedSessionDate: string | null = null;
  let walkOpen = true;
  const sessionStreaks: SessionStreakMark[] = [];
  const events: StreakComputation["events"] = [];
  const milestoneSeen = new Set<string>();

  interface WeekBucket {
    required: number;
    completed: number;
    missed: boolean;
    hasPending: boolean;
    anySession: boolean;
  }
  const weeks = new Map<string, WeekBucket>();
  const weekOf = (session: ScheduledSession): WeekBucket => {
    const key = isoWeekKey(session.scheduledDate);
    let bucket = weeks.get(key);
    if (!bucket) {
      bucket = { required: 0, completed: 0, missed: false, hasPending: false, anySession: true };
      weeks.set(key, bucket);
    }
    return bucket;
  };

  for (const session of ordered) {
    switch (session.status) {
      case "completed": {
        const week = weekOf(session);
        week.required += 1;
        week.completed += 1;
        if (walkOpen) {
          current += 1;
          if (current > best) best = current;
          sessionStreaks.push({ sessionId: session.id, streakAfter: current });
          lastCompletedSessionId = session.id;
          for (const milestone of STREAK_MILESTONES) {
            if (current === milestone && !milestoneSeen.has(String(milestone))) {
              milestoneSeen.add(String(milestone));
              events.push({
                type: "milestone",
                key: "milestone:" + String(milestone),
                value: milestone,
                occurredAt: session.completedAt ?? nowTs,
              });
            }
          }
        }
        break;
      }
      case "missed": {
        const week = weekOf(session);
        week.required += 1;
        week.missed = true;
        if (walkOpen) {
          current = 0;
          lastMissedSessionDate = session.scheduledDate;
          events.push({
            type: "broken",
            key: "broken:" + session.id,
            value: 0,
            occurredAt: session.updatedAt,
          });
        }
        break;
      }
      case "pending": {
        const week = weekOf(session);
        week.required += 1;
        week.hasPending = true;
        walkOpen = false;
        break;
      }
      case "paused":
      case "rescheduled":
      case "cancelled":
        // Neutral: never required, never history-rewriting.
        break;
    }
  }

  const perfectWeekKeys: string[] = [];
  for (const [key, week] of weeks) {
    if (week.required > 0 && !week.missed && !week.hasPending && week.completed === week.required) {
      perfectWeekKeys.push(key);
    }
  }
  perfectWeekKeys.sort();

  return {
    currentStreak: current,
    bestStreak: best,
    perfectWeeks: perfectWeekKeys.length,
    lastCompletedSessionId,
    completedSinceLastMiss: current,
    lastMissedSessionDate,
    sessionStreaks,
    events,
    perfectWeekKeys,
  };
}

/** Whether the ISO week containing the date is a finalized perfect week. */
export function isPerfectWeek(sessions: readonly ScheduledSession[], dateStr: string): boolean {
  const key = isoWeekKey(dateStr);
  const inWeek = sessions.filter((s) => isoWeekKey(s.scheduledDate) === key);
  const required = inWeek.filter((s) => s.status === "completed" || s.status === "missed" || s.status === "pending");
  if (required.length === 0) return false;
  return required.every((s) => s.status === "completed");
}

export function streakEventTypeLabel(type: StreakEventType): string {
  return type;
}
