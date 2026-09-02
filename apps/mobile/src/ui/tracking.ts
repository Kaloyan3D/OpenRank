/**
 * Tracking-type-aware set field layout (Phase 4, tasks G/N).
 *
 * The set editor renders exactly the fields the exercise's tracking type
 * demands - never a meaningless weight column. Canonical units:
 * kg / meters / seconds. Bodyweight exercises store the EXTERNAL value only
 * (added kg for weighted, assistance kg for assisted) - Phase 5 ranking-core
 * computes effective load.
 */

import type { TrackingType } from "@openrank/domain";

export type SetFieldKind = "weight" | "reps" | "duration" | "distance";

export interface SetFieldSpec {
  kind: SetFieldKind;
  /** Column header, e.g. "kg", "+kg", "assist kg", "reps", "min". */
  label: string;
}

/** The ordered field list for one tracking type (display-unit aware). */
export function fieldsForTracking(
  trackingType: TrackingType,
  weightLabel = "kg",
  distanceLabel = "km",
): SetFieldSpec[] {
  switch (trackingType) {
    case "weight_reps":
      return [
        { kind: "weight", label: weightLabel },
        { kind: "reps", label: "reps" },
      ];
    case "bodyweight_reps":
      return [{ kind: "reps", label: "reps" }];
    case "bodyweight_weighted":
      return [
        { kind: "weight", label: "+" + weightLabel },
        { kind: "reps", label: "reps" },
      ];
    case "bodyweight_assisted":
      return [
        { kind: "weight", label: weightLabel + " assist" },
        { kind: "reps", label: "reps" },
      ];
    case "reps_only":
      return [{ kind: "reps", label: "reps" }];
    case "duration":
      return [
        { kind: "duration", label: "min" },
        { kind: "duration", label: "sec" },
      ];
    case "distance_duration":
      return [
        { kind: "distance", label: distanceLabel },
        { kind: "duration", label: "min" },
        { kind: "duration", label: "sec" },
      ];
  }
}

/** True when the tracking type stores an external load in weight_kg. */
export function usesWeightField(trackingType: TrackingType): boolean {
  return trackingType === "weight_reps" || trackingType === "bodyweight_weighted" || trackingType === "bodyweight_assisted";
}
