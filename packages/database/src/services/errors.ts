/** Structured service errors (Phase 4) - the UI matches on these classes. */

/** Starting a workout while one is already active for the profile. */
export class ActiveWorkoutConflictError extends Error {
  constructor(public readonly activeWorkoutId: string) {
    super("a workout is already active (" + activeWorkoutId + ") - resume it, discard it, or cancel");
    this.name = "ActiveWorkoutConflictError";
  }
}

/** Finishing while incomplete set rows exist (policy: reject). */
export class IncompleteSetsError extends Error {
  constructor(public readonly count: number) {
    super(String(count) + " incomplete set(s) - remove them or return to the workout");
    this.name = "IncompleteSetsError";
  }
}
