/**
 * Small shared workout helpers (Phase 4).
 *
 * The screens read canonical state through the service layer on every render
 * (SQLite stays the single source of truth); these helpers only provide the
 * derived "now" ticker for live durations and a pure counting utility.
 */

import { useEffect, useState } from "react";
import type { WorkoutExerciseDetail } from "@openrank/domain";

/**
 * A wall-clock value that ticks every second while enabled. Duration is
 * always derived from timestamps (task Z) - never a stored counter.
 */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** Count of completed sets across exercise blocks (for the resume card). */
export function countCompletedSets(exercises: WorkoutExerciseDetail[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const e of exercises) {
    for (const s of e.sets) {
      total += 1;
      if (s.completedAt != null) done += 1;
    }
  }
  return { done, total };
}
