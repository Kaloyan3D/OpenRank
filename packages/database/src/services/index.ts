/**
 * Application services (Phase 4): the layer between UI and repositories.
 * UI -> services -> repositories -> SQLite. Screens never issue SQL and
 * never hold canonical workout state (docs/WORKOUT_SPEC.md).
 */

export { WorkoutService } from "./workout-service";
export type { WorkoutSummary, WorkoutStartOptions, FinishOptions, CompleteSetResult, WorkoutServiceRepos } from "./workout-service";
export { RoutineService } from "./routine-service";
export type { RoutineServiceRepos, RoutineExerciseInput } from "./routine-service";
export { RestTimerService } from "./rest-timer-service";
export { ActiveWorkoutConflictError, IncompleteSetsError } from "./errors";
export { SetValidationError } from "./set-validation";
export { validateSetInput, validateSetForCompletion } from "./set-validation";
export { computeLogicalTrainingDate, computeStartLocalDate, LOGICAL_DAY_BOUNDARY_MINUTES } from "./logical-date";

import type { DatabaseDriver } from "../driver";
import type { OpenDatabaseResult } from "../index";
import { RestTimerService } from "./rest-timer-service";
import { WorkoutService } from "./workout-service";
import { RoutineService } from "./routine-service";
import { SqliteRestTimerRepository } from "../repositories/rest-timer";

export interface OpenRankServices {
  workout: WorkoutService;
  routine: RoutineService;
  restTimer: RestTimerService;
}

/** Build the service layer over an opened database (call once per app run). */
export function createServices(
  driver: DatabaseDriver,
  repos: OpenDatabaseResult,
  options: { now?: () => string } = {},
): OpenRankServices {
  const restTimerRepo = new SqliteRestTimerRepository(driver);
  const restTimer = new RestTimerService(driver, restTimerRepo, options.now);
  return {
    workout: new WorkoutService(driver, repos, restTimer, options.now),
    routine: new RoutineService(repos),
    restTimer,
  };
}