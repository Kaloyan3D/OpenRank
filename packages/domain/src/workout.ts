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
  /**
   * Target-set snapshot copied from the routine when the workout started
   * (Phase 4). Null for freestyle exercises. Later routine edits never
   * mutate this - the workout owns its session structure once started.
   */
  targetSets: SetTargetSnapshot[] | null;
}

/** One routine target set, snapshotted into a workout at start time. */
export interface SetTargetSnapshot {
  setType: SetType;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetRpe: number | null;
  targetRir: number | null;
}

/** The most relevant prior completed performance for one exercise. */
export interface PreviousPerformance {
  workoutId: string;
  startedAt: string;
  /** Completed sets of that workout for the exercise, in logged order. */
  sets: WorkoutSet[];
}

/** Persisted rest-timer state (authoritative: timestamps, not countdowns). */
export interface RestTimerState {
  profileId: string;
  workoutId: string;
  workoutExerciseId: string | null;
  startedAt: string;
  /** Absolute end instant - the countdown is always derived from this. */
  endsAt: string;
  durationSeconds: number;
  /**
   * Derived remaining seconds (max(0, endsAt - now)). Computed on read with
   * the caller's clock, so backgrounding and process restarts are free.
   */
  remainingSeconds: number;
  /** True when ends_at <= now (the rest period is over). */
  expired: boolean;
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
  /**
   * Phase 7.1: durable onboarding position (null before the flow starts and
   * after completion). Survives process death - the resume route is derived
   * from this, never from React state.
   */
  onboardingStep: string | null;
}

export interface BodyweightEntry {
  id: string;
  profileId: string;
  measuredAt: string;
  weightKg: number;
  source: string;
  note: string | null;
}