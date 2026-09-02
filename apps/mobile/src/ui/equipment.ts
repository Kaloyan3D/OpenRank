/**
 * Equipment display labels + exercise-picker filter semantics
 * (Phase 8.2 P0.1 correctness).
 *
 * The picker equipment state is three-valued on purpose and mirrors the
 * repository contract exactly:
 *
 *   undefined  no equipment filter ("All") - the repository sees NO equipment
 *              predicate at all;
 *   null       no-equipment exercises only (WHERE exercises.equipment IS NULL);
 *   string     exercises whose canonical equipment equals that tag.
 *
 * ExerciseRepository deliberately keeps null = "equipment IS NULL" (repository
 * tests and import flows rely on it), so the picker spells "no filter" as
 * undefined - never null. This module is UI-agnostic (no react-native import)
 * so the semantics stay unit-testable in Node.
 */

import type { ExerciseSearchOptions, MajorGroup, TrackingType } from "@openrank/domain";

/** A concrete equipment filter: null selects no-equipment rows (IS NULL). */
export type EquipmentFilter = string | null;

/** Picker equipment state: undefined = no equipment filter (All). */
export type EquipmentFilterState = EquipmentFilter | undefined;

export interface EquipmentFilterOption {
  /** The canonical equipment value; null = "No equipment" (equipment IS NULL). */
  value: EquipmentFilter;
  /** Chip label shown in the picker. */
  label: string;
}

/**
 * Every equipment category the picker exposes as a filter. This deliberately
 * covers ALL distinct canonical equipment values of the bundled catalog
 * (locked by a regression test) - additional categories are never silently
 * hidden, and "other" stays reachable. Null is exposed as "No equipment",
 * never as bodyweight.
 */
export const EQUIPMENT_FILTERS: readonly EquipmentFilterOption[] = [
  { value: null, label: "No equipment" },
  { value: "barbell", label: "barbell" },
  { value: "dumbbell", label: "dumbbell" },
  { value: "machine", label: "machine" },
  { value: "cable", label: "cable" },
  { value: "kettlebell", label: "kettlebell" },
  { value: "bodyweight", label: "bodyweight" },
  { value: "bands", label: "bands" },
  { value: "ez-curl-bar", label: "ez-curl-bar" },
  { value: "exercise-ball", label: "exercise-ball" },
  { value: "medicine-ball", label: "medicine-ball" },
  { value: "foam-roll", label: "foam-roll" },
  { value: "other", label: "other" },
];

/**
 * Honest display label for an exercise row: NULL (or unknown) equipment means
 * "No equipment". Actual bodyweight exercises carry equipment = "bodyweight"
 * and are labelled as such; the two are never conflated.
 */
export function equipmentLabel(equipment: string | null | undefined): string {
  return equipment == null ? "No equipment" : equipment;
}

/**
 * Chip toggle semantics: pressing the active chip clears back to undefined
 * ("All") - never to null, which would silently become an IS NULL filter.
 */
export function toggleEquipmentFilter(
  current: EquipmentFilterState,
  value: EquipmentFilter,
): EquipmentFilterState {
  return current === value ? undefined : value;
}

/** Picker filter state (the free-text query is separate text state). */
export interface ExercisePickerFilters {
  query: string;
  group: MajorGroup | null;
  tracking: TrackingType | null;
  /** undefined = no equipment filter (All); null = no-equipment exercises only. */
  equipment: EquipmentFilterState;
}

/**
 * Repository search options for the picker.
 *
 * No hard-coded row cap is applied: "All" must mean every matching exercise
 * (876 local SQLite rows, rendered through FlatList windowing) and the
 * on-screen count must be the honest result-set size. Equipment is included
 * only when a concrete filter is chosen, so the default state never collapses
 * into the repository's null (= equipment IS NULL) predicate.
 */
export function exercisePickerSearchOptions(filters: ExercisePickerFilters): ExerciseSearchOptions {
  const options: ExerciseSearchOptions = {
    query: filters.query,
    majorGroup: filters.group,
    trackingType: filters.tracking,
  };
  if (filters.equipment !== undefined) {
    options.equipment = filters.equipment;
  }
  return options;
}
