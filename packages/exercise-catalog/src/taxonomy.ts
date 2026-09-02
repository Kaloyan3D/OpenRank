/**
 * Canonical muscle taxonomy + major-group mapping.
 *
 * Muscle ids intentionally mirror the primary-muscle keys used by
 * ranking-core (Hevy primary_muscle_group values), so a catalog exercise's
 * primary muscle maps 1:1 onto the ranking engine's group routing
 * (PRIMARY_TO_GROUP). The upstream Free Exercise DB names are slightly
 * different ("middle back" vs our "upper_back") and are mapped explicitly.
 */
import type { CatalogMuscle, MajorGroup } from "./schema";

export const MUSCLES: readonly CatalogMuscle[] = [
  { id: "abdominals", name: "Abdominals", majorGroup: "core" },
  { id: "abductors", name: "Abductors", majorGroup: "legs" },
  { id: "adductors", name: "Adductors", majorGroup: "legs" },
  { id: "biceps", name: "Biceps", majorGroup: "arms" },
  { id: "calves", name: "Calves", majorGroup: "legs" },
  { id: "chest", name: "Chest", majorGroup: "chest" },
  { id: "forearms", name: "Forearms", majorGroup: "arms" },
  { id: "glutes", name: "Glutes", majorGroup: "legs" },
  { id: "hamstrings", name: "Hamstrings", majorGroup: "legs" },
  { id: "lats", name: "Lats", majorGroup: "back" },
  { id: "lower_back", name: "Lower Back", majorGroup: "back" },
  { id: "neck", name: "Neck", majorGroup: "shoulders" },
  { id: "quadriceps", name: "Quadriceps", majorGroup: "legs" },
  { id: "shoulders", name: "Shoulders", majorGroup: "shoulders" },
  { id: "traps", name: "Traps", majorGroup: "back" },
  { id: "triceps", name: "Triceps", majorGroup: "arms" },
  // "upper_back" is the canonical id for the rhomboid/mid-back area that the
  // Free Exercise DB calls "middle back" (and Hevy calls "upper_back").
  { id: "upper_back", name: "Upper Back", majorGroup: "back" },
];

export const MUSCLE_IDS: ReadonlySet<string> = new Set(MUSCLES.map((m) => m.id));

export const MAJOR_GROUPS: readonly MajorGroup[] = [
  "legs",
  "chest",
  "back",
  "shoulders",
  "arms",
  "core",
];

/** majorGroup -> canonical muscle ids. */
export const MUSCLES_BY_GROUP: Record<MajorGroup, string[]> = (() => {
  const map = {
    legs: [],
    chest: [],
    back: [],
    shoulders: [],
    arms: [],
    core: [],
  } as Record<MajorGroup, string[]>;
  for (const m of MUSCLES) map[m.majorGroup].push(m.id);
  return map;
})();

/**
 * Free Exercise DB muscle name -> canonical muscle id.
 * (The upstream names are already lowercase; only the two compound names
 * need explicit mapping.)
 */
export const FREE_DB_MUSCLE_TO_ID: Record<string, string> = {
  abdominals: "abdominals",
  abductors: "abductors",
  adductors: "adductors",
  biceps: "biceps",
  calves: "calves",
  chest: "chest",
  forearms: "forearms",
  glutes: "glutes",
  hamstrings: "hamstrings",
  lats: "lats",
  "lower back": "lower_back",
  "middle back": "upper_back",
  neck: "neck",
  quadriceps: "quadriceps",
  shoulders: "shoulders",
  traps: "traps",
  triceps: "triceps",
};

/** Determine the major group implied by a set of primary muscle ids. */
export function majorGroupForMuscles(primaryMuscleIds: readonly string[]): MajorGroup | null {
  for (const id of primaryMuscleIds) {
    const muscle = MUSCLES.find((m) => m.id === id);
    if (muscle) return muscle.majorGroup;
  }
  return null;
}