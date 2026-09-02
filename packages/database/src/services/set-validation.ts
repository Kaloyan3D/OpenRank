/**
 * Set value validation (Phase 4, task M/G/N).
 *
 * Validation runs at the service layer (never in screens): the UI may hold
 * incomplete/empty values while editing, but completing a set requires the
 * values demanded by the exercise's tracking type. Weights are decimal kg,
 * never negative; no artificial upper limits (strong users are legitimate).
 */

import type { TrackingType, WorkoutSetInput } from "@openrank/domain";

export class SetValidationError extends Error {}

const RPE_MIN = 1;
const RPE_MAX = 10;
const RIR_MIN = 0;
const RIR_MAX = 10;

/** Edit-time validation: every provided field must be physically possible. */
export function validateSetInput(trackingType: TrackingType, input: Partial<WorkoutSetInput>): void {
  void trackingType; // edit-time rules are type-agnostic (partial values allowed)
  if (input.weightKg !== undefined && input.weightKg !== null) {
    assertFinite("weight", input.weightKg);
    if (input.weightKg < 0) throw new SetValidationError("weight cannot be negative");
  }
  if (input.reps !== undefined && input.reps !== null) {
    assertFinite("reps", input.reps);
    if (!Number.isInteger(input.reps)) throw new SetValidationError("reps must be a whole number");
    if (input.reps < 0) throw new SetValidationError("reps cannot be negative");
  }
  if (input.durationSeconds !== undefined && input.durationSeconds !== null) {
    assertFinite("duration", input.durationSeconds);
    if (input.durationSeconds < 0) throw new SetValidationError("duration cannot be negative");
  }
  if (input.distanceMeters !== undefined && input.distanceMeters !== null) {
    assertFinite("distance", input.distanceMeters);
    if (input.distanceMeters < 0) throw new SetValidationError("distance cannot be negative");
  }
  validateIntensity(input.rpe, input.rir);
}

/** Completion-time validation: the set must satisfy its tracking type. */
export function validateSetForCompletion(
  trackingType: TrackingType,
  set: {
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceMeters: number | null;
    rpe: number | null;
    rir: number | null;
  },
): void {
  validateIntensity(set.rpe, set.rir);
  switch (trackingType) {
    case "weight_reps":
      requirePositive("weight", set.weightKg, { allowZero: true });
      requirePositive("reps", set.reps, { integer: true });
      break;
    case "bodyweight_reps":
    case "reps_only":
      requirePositive("reps", set.reps, { integer: true });
      break;
    case "bodyweight_weighted":
      // Added weight (external load on top of bodyweight).
      requirePositive("added weight", set.weightKg, { allowZero: true });
      requirePositive("reps", set.reps, { integer: true });
      break;
    case "bodyweight_assisted":
      // Assistance weight entered by the user (0 = no assistance).
      requirePositive("assistance weight", set.weightKg, { allowZero: true });
      requirePositive("reps", set.reps, { integer: true });
      break;
    case "duration":
      requirePositive("duration", set.durationSeconds, { allowZero: false });
      break;
    case "distance_duration":
      requirePositive("distance", set.distanceMeters, { allowZero: false });
      requirePositive("duration", set.durationSeconds, { allowZero: false });
      break;
  }
}

function validateIntensity(rpe: number | null | undefined, rir: number | null | undefined): void {
  if (rpe != null) {
    assertFinite("RPE", rpe);
    if (rpe < RPE_MIN || rpe > RPE_MAX) {
      throw new SetValidationError("RPE must be between " + RPE_MIN + " and " + RPE_MAX);
    }
  }
  if (rir != null) {
    assertFinite("RIR", rir);
    if (!Number.isInteger(rir)) throw new SetValidationError("RIR must be a whole number");
    if (rir < RIR_MIN || rir > RIR_MAX) {
      throw new SetValidationError("RIR must be between " + RIR_MIN + " and " + RIR_MAX);
    }
  }
}

function requirePositive(
  label: string,
  value: number | null | undefined,
  opts: { integer?: boolean; allowZero?: boolean },
): void {
  if (value == null || !Number.isFinite(value)) {
    throw new SetValidationError(label + " is required to complete this set");
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new SetValidationError(label + " must be a whole number");
  }
  if (opts.allowZero ? value < 0 : value <= 0) {
    throw new SetValidationError(label + " must be greater than " + (opts.allowZero ? "or equal to 0" : "0"));
  }
}

function assertFinite(label: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SetValidationError(label + " must be a finite number");
  }
}
