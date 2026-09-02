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
export { ScheduleService, SchedulePauseOverlapError, RescheduleError, GENERATION_HORIZON_DAYS } from "./schedule-service";
export type { ScheduleClockOptions, ReconcileReport, WeekDayState } from "./schedule-service";
export { StreakService } from "./streak-service";
export type { StreakProcessReport, StreakCurrentState } from "./streak-service";
export { computeStreakState, STREAK_MILESTONES, isPerfectWeek } from "./streak-engine";
export type { StreakComputation, SessionStreakMark } from "./streak-engine";
export { isoWeekKey, isoWeekdayOf, addDays, startOfIsoWeek, datesBetween } from "./iso-week";

import type { DatabaseDriver } from "../driver";
import type { OpenDatabaseResult } from "../index";
import { RestTimerService } from "./rest-timer-service";
import { WorkoutService } from "./workout-service";
import { RoutineService } from "./routine-service";
import { DerivedDataService } from "./derived-service";
import { ScheduleService } from "./schedule-service";
import { StreakService } from "./streak-service";
import { SqliteRestTimerRepository } from "../repositories/rest-timer";

export interface OpenRankServices {
  workout: WorkoutService;
  routine: RoutineService;
  restTimer: RestTimerService;
  /** Phase 5: derived-state reads + worker facade (never canonical). */
  derived: DerivedDataService;
  /** Phase 6: weekly training schedule + scheduled-session ledger. */
  schedule: ScheduleService;
  /** Phase 6: scheduled-session streaks (projection over the ledger). */
  streak: StreakService;
}

/** Build the service layer over an opened database (call once per app run). */
export function createServices(
  driver: DatabaseDriver,
  repos: OpenDatabaseResult,
  options: { now?: () => string } = {},
): OpenRankServices {
  const restTimerRepo = new SqliteRestTimerRepository(driver);
  const restTimer = new RestTimerService(driver, restTimerRepo, options.now);
  const derived = new DerivedDataService(
    repos,
    driver,
    {
      personalRecords: repos.personalRecords,
      rankSnapshots: repos.rankSnapshots,
      rankEvents: repos.rankEvents,
    },
    { now: options.now ?? (() => new Date().toISOString()), newId: repos.newId ?? (() => crypto.randomUUID()) },
  );
  const nowFn = options.now ?? (() => new Date().toISOString());
  const newIdFn = repos.newId ?? (() => crypto.randomUUID());
  const schedule = new ScheduleService(
    driver,
    {
      schedule: repos.trainingSchedule,
      sessions: repos.scheduledSessions,
      exceptions: repos.scheduleExceptions,
      workout: repos.workout,
    },
    repos.streakDirty,
    nowFn,
    newIdFn,
  );
  const streak = new StreakService(
    driver,
    {
      sessions: repos.scheduledSessions,
      exceptions: repos.scheduleExceptions,
      cache: repos.streakCache,
      events: repos.streakEvents,
      dirty: repos.streakDirty,
      workout: repos.workout,
    },
    schedule,
    nowFn,
    newIdFn,
  );
  return {
    workout: new WorkoutService(driver, repos, restTimer, options.now, repos.streakDirty),
    routine: new RoutineService(repos),
    restTimer,
    derived,
    schedule,
    streak,
  };
}