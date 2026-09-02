/** Superset visual grouping (Phase 4, task Q). */

import type { WorkoutExerciseDetail } from "@openrank/domain";

export interface SupersetBlock {
  /** Label shown for the group, e.g. "Superset A". */
  label: string | null;
  items: WorkoutExerciseDetail[];
}

/**
 * Group consecutive exercises with the same superset_group (positions are
 * dense, so adjacency == same block). Exercises without a group stay single.
 */
export function groupSupersets(exercises: WorkoutExerciseDetail[]): SupersetBlock[] {
  const blocks: SupersetBlock[] = [];
  for (const e of exercises) {
    const group = e.workoutExercise.supersetGroup;
    const last = blocks[blocks.length - 1];
    if (group != null && last?.label === group) {
      last.items.push(e);
    } else {
      blocks.push({ label: group, items: [e] });
    }
  }
  return blocks;
}

/** Letters for the superset picker: null -> "none", then A, B, C... */
export function supersetChoices(): { value: string | null; label: string }[] {
  const out: { value: string | null; label: string }[] = [{ value: null, label: "None" }];
  for (let i = 0; i < 6; i++) {
    out.push({ value: String.fromCharCode(65 + i), label: "Superset " + String.fromCharCode(65 + i) });
  }
  return out;
}
