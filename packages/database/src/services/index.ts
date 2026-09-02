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
export { NotificationService, NOTIFICATION_HORIZON_DAYS } from "./notifications/notification-service";
export {
  ProfileService, ONBOARDING_STEPS, ONBOARDING_BODYWEIGHT_SOURCE,
  resolveRootRoute, resolveResumeStep,
} from "./profile-service";
export { resolveHomeSessionView } from "./home-view";
export { AnalyticsService } from "./analytics-service";
export type {
  BodyweightPoint, E1rmPoint, RankTimelinePoint, WeeklyActivityBucket,
  WorkoutVolumeSlice, StrengthProfileGroupSummary,
} from "./analytics-service";
export { ACHIEVEMENT_DEFINITIONS, evaluateAchievements } from "./achievement-definitions";
export { AchievementService } from "./achievement-service";
export type { AchievementStats, AchievementDefinition, AchievementView } from "./achievement-definitions";
export type { HomeSessionView, HomeSessionInput, WeekDayStateName } from "./home-view";
export type {
  OnboardingStep, LocalProfileInput, LocalProfileResult, ProfileServiceDeps,
} from "./profile-service";
export type { NotificationReconcileReport, ReconcileOptions as NotificationReconcileOptions } from "./notifications/notification-service";
export { NullNotificationPlatform } from "./notifications/platform";
export type { NotificationPlatform, PlatformNotificationRequest, NotificationChannelId } from "./notifications/platform";
export { reminderInstant, logicalDayEndInstant, localWallInstant } from "./notifications/time";
export { primaryReminderContent, secondaryReminderContent, restTimerContent } from "./notifications/content";
export { validateNotificationPayload, resolveNotificationRoute, trainingDedupeKey, restDedupeKey, stableHash } from "./notifications/payload";

import type { DatabaseDriver } from "../driver";
import type { OpenDatabaseResult } from "../index";
import { RestTimerService } from "./rest-timer-service";
import { WorkoutService } from "./workout-service";
import { RoutineService } from "./routine-service";
import { DerivedDataService } from "./derived-service";
import { ScheduleService } from "./schedule-service";
import { StreakService } from "./streak-service";
import { SqliteRestTimerRepository } from "../repositories/rest-timer";
import { NotificationService } from "./notifications/notification-service";
import { ProfileService } from "./profile-service";
import { AnalyticsService } from "./analytics-service";
import { AchievementService } from "./achievement-service";
import { NullNotificationPlatform } from "./notifications/platform";
import type { NotificationPlatform } from "./notifications/platform";

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
  /** Phase 7: local notification scheduling/reconciliation (opt-in). */
  notifications: NotificationService;
  /** Phase 7.1: local-profile lifecycle + onboarding state. */
  profile: ProfileService;
  /** Phase 8: deterministic analytics projections (charts, timelines). */
  analytics: AnalyticsService;
  /** Phase 8: local achievement read model (pure projection). */
  achievements: AchievementService;
}

/** Build the service layer over an opened database (call once per app run). */
export function createServices(
  driver: DatabaseDriver,
  repos: OpenDatabaseResult,
  options: { now?: () => string; notificationPlatform?: NotificationPlatform } = {},
): OpenRankServices {
  const nowFn = options.now ?? (() => new Date().toISOString());
  const newIdFn = repos.newId ?? (() => crypto.randomUUID());
  const notificationPlatform = options.notificationPlatform ?? new NullNotificationPlatform();
  const profile = new ProfileService(driver, {
    profile: repos.profile,
    bodyweight: repos.bodyweight,
  });
  const notifications = new NotificationService(
    driver,
    {
      prefs: repos.notificationPreferences,
      jobs: repos.notificationJobs,
      sessions: repos.scheduledSessions,
      schedule: repos.trainingSchedule,
      restTimer: new SqliteRestTimerRepository(driver),
      routines: repos.routine,
    },
    notificationPlatform,
    { now: nowFn, newId: newIdFn },
  );
  // Optional rest-complete notification: delivery is fire-and-forget and can
  // never affect timer correctness (spec AB). Deferred to a macrotask so the
  // reconcile never interleaves with the synchronous canonical flow (and
  // never consumes the shared clock mid-operation); failures retry at the
  // next reconcile (app start / next mutation).
  const restTimer = new RestTimerService(driver, new SqliteRestTimerRepository(driver), options.now, (profileId) => {
    setTimeout(() => {
      void notifications.reconcileNotifications(profileId).catch(() => {
        /* retried on the next reconcile */
      });
    }, 0);
  });
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
  const analytics = new AnalyticsService(
    {
      bodyweight: repos.bodyweight,
      personalRecords: repos.personalRecords,
      rankSnapshots: repos.rankSnapshots,
      workout: repos.workout,
    },
    nowFn,
  );
  const achievements = new AchievementService({
    workout: repos.workout,
    personalRecords: repos.personalRecords,
    rankSnapshots: repos.rankSnapshots,
    bodyweight: repos.bodyweight,
    bestStreakOf: (profileId) => streak.getCurrentState(profileId).cache.bestStreak,
  });
  return {
    workout: new WorkoutService(driver, repos, restTimer, options.now, repos.streakDirty),
    routine: new RoutineService(repos),
    restTimer,
    derived,
    schedule,
    streak,
    notifications,
    profile,
    analytics,
    achievements,
  };
}