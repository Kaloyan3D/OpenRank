/**
 * Canonical workout domain models (types only, Phase 4 consumes these).
 */

export type WorkoutStatus = "active" | "completed" | "discarded";

export type SetType = "warmup" | "normal" | "drop" | "failure" | "amrap";

export interface WorkoutSet {
  id: string;
  workoutExerciseId: string;
  position: number;
  setType: SetType;
  /** Kilograms. Always kilograms internally. */
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  rir: number | null;
  side: "left" | "right" | null;
  completedAt: string | null;
}

export interface WorkoutExercise {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  restSeconds: number | null;
  supersetGroup: string | null;
  notes: string | null;
}

export interface Workout {
  id: string;
  profileId: string;
  routineId: string | null;
  title: string | null;
  status: WorkoutStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Local calendar date (YYYY-MM-DD) under the 04:00 logical day boundary. */
  startLocalDate: string;
  /**
   * The logical training day this workout belongs to (YYYY-MM-DD). In Phase 3
   * this always equals startLocalDate; the schedule engine (Phase 6) may move
   * a session to a different logical day than it started on.
   */
  logicalTrainingDate: string;
  startTimezoneOffsetMinutes: number;
  notes: string | null;
}

export interface Profile {
  id: string;
  displayName: string;
  /** Selects ranking thresholds only. */
  strengthStandard: "male" | "female";
  unitSystem: "metric" | "imperial";
  onboardingCompleted: boolean;
}

export interface BodyweightEntry {
  id: string;
  profileId: string;
  measuredAt: string;
  weightKg: number;
  source: string;
  note: string | null;
}