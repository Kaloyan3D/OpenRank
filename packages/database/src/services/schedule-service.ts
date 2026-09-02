/**
 * ScheduleService (Phase 6, spec AS).
 *
 * Owns the weekly training schedule, the materialized scheduled-session
 * ledger and schedule exceptions (planned pauses). The ledger - never the
 * current weekly configuration - is the historical truth for streaks.
 *
 * Deterministic policies (docs/STREAK_SPEC.md):
 * - Generation horizon: 35 days ahead, INSERT OR IGNORE idempotent.
 * - Miss resolution: a pending session becomes missed only after its logical
 *   day window definitively passed (scheduled_date < today's logical day).
 * - Pause overlay precedes expiry, so an unfinalized (never-resolved)
 *   pending session inside a pause becomes paused, not missed; finalized
 *   misses are immutable - retroactive rescue is impossible (spec Y).
 * - Disabling the schedule cancels pending today/future sessions
 *   (status 'cancelled' - an explicit non-historical state) and creates no
 *   misses; past-due pending also cancels (no misses while disabled).
 * - Schedule changes cancel non-rescheduled pending sessions from today's
 *   logical day onward and regenerate them from the new configuration;
 *   completed/missed/paused/rescheduled history is never touched (spec I/AP).
 */

import type {
  ScheduleException,
  ScheduleWeekday,
  ScheduledSession,
  TrainingSchedule,
  TrainingScheduleDay,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import type { ScheduleExceptionRepository, ScheduledSessionRepository, StreakDirtyRepository, TrainingScheduleRepository, WorkoutRepository } from "@openrank/domain";
import { computeLogicalTrainingDate } from "./logical-date";
import { addDays, datesBetween, isoWeekKey, isoWeekdayOf, startOfIsoWeek } from "./iso-week";

export const GENERATION_HORIZON_DAYS = 35;

export interface ScheduleClockOptions {
  /** Overrides "now" (deterministic tests). */
  todayUtc?: string | undefined;
  /** Device UTC offset in minutes (JS getTimezoneOffset sign: positive west). */
  timezoneOffsetMinutes?: number | undefined;
}

export interface ReconcileReport {
  generated: number;
  cancelled: number;
  paused: number;
  expired: number;
  reopened: number;
}

export interface WeekDayState {
  date: string;
  weekday: ScheduleWeekday;
  state: "completed" | "planned" | "rest" | "missed" | "paused" | "rescheduled";
  sessionId: string | null;
  workoutId: string | null;
  routineId: string | null;
}

export class SchedulePauseOverlapError extends Error {
  constructor() {
    super("pause overlaps an existing planned pause");
  }
}

export class RescheduleError extends Error {}

export interface ScheduleServiceRepos {
  schedule: TrainingScheduleRepository;
  sessions: ScheduledSessionRepository;
  exceptions: ScheduleExceptionRepository;
  workout: WorkoutRepository;
}

export class ScheduleService {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly repos: ScheduleServiceRepos,
    private readonly streakDirty: StreakDirtyRepository | null,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  private todayLogical(options: ScheduleClockOptions): string {
    return computeLogicalTrainingDate(options.todayUtc ?? this.now(), options.timezoneOffsetMinutes ?? 0);
  }

  // ------------------------------------------------------------- schedule --

  getSchedule(profileId: string): { schedule: TrainingSchedule; days: TrainingScheduleDay[] } {
    const schedule = this.repos.schedule.ensureDefault(profileId);
    return { schedule, days: this.repos.schedule.getDays(schedule.id) };
  }

  /**
   * Replace the weekly configuration (all seven days). Bumps the revision
   * only when something actually changed. Today's and future non-rescheduled
   * pending obligations are reconciled to the new explicit schedule; history
   * is preserved (spec F/I/AP).
   */
  updateWeeklySchedule(
    profileId: string,
    days: Array<{ weekday: ScheduleWeekday; enabled: boolean; routineId: string | null }>,
    options: ScheduleClockOptions = {},
  ): { schedule: TrainingSchedule; days: TrainingScheduleDay[]; revision: number } {
    if (days.length !== 7) throw new Error("weekly schedule requires exactly 7 weekday entries");
    const seen = new Set<number>();
    for (const d of days) {
      if (seen.has(d.weekday)) throw new Error("duplicate weekday entry: " + String(d.weekday));
      seen.add(d.weekday);
    }
    return this.driver.transaction(() => {
      const current = this.getSchedule(profileId);
      const changed =
        current.days.some((day) => {
          const next = days.find((d) => d.weekday === day.weekday);
          return !next || next.enabled !== day.enabled || next.routineId !== day.routineId;
        });
      if (changed) {
        for (const d of days) {
          this.repos.schedule.upsertDay(current.schedule.id, d);
        }
        this.repos.schedule.bumpRevision(current.schedule.id);
        this.streakDirty?.mark(profileId, "schedule", current.schedule.id, "schedule_changed");
      }
      const today = this.todayLogical(options);
      this.cancelPendingFrom(profileId, today);
      const schedule = this.repos.schedule.getForProfile(profileId)!;
      return { schedule, days: this.repos.schedule.getDays(schedule.id), revision: schedule.revision };
    });
  }

  /**
   * Enable/disable the schedule. Disabling cancels today/future pending
   * obligations (never creates misses, never touches history) - spec AH/AI.
   */
  setScheduleEnabled(profileId: string, enabled: boolean, options: ScheduleClockOptions = {}): void {
    this.driver.transaction(() => {
      const schedule = this.repos.schedule.ensureDefault(profileId);
      if (schedule.enabled === enabled) return;
      this.repos.schedule.setEnabled(schedule.id, enabled);
      if (!enabled) {
        this.cancelPendingFrom(profileId, this.todayLogical(options));
      }
      this.streakDirty?.mark(profileId, "schedule", schedule.id, "schedule_enabled_changed");
    });
  }

  // ----------------------------------------------------------- ledger ops --

  /**
   * Deterministic generation + resolution (spec H). Safe to run any number of
   * times: generation is INSERT OR IGNORE under the active-date unique index,
   * resolutions are status transitions with explicit preconditions.
   *
   * skipExpiry lets StreakService interleave: materialize -> MATCH completed
   * workouts -> expire -> project. Matching first is what makes a workout
   * finished before its day window but processed after it (phone closed
   * overnight) complete its obligation instead of being expired first.
   */
  reconcileUpcomingSessions(
    profileId: string,
    options: ScheduleClockOptions = {},
    internal?: { skipExpiry?: boolean },
  ): ReconcileReport {
    const report: ReconcileReport = { generated: 0, cancelled: 0, paused: 0, expired: 0, reopened: 0 };
    return this.driver.transaction(() => {
      const schedule = this.repos.schedule.ensureDefault(profileId);
      const today = this.todayLogical(options);
      if (!schedule.enabled) {
        report.cancelled += this.cancelPendingFrom(profileId, today);
        return report;
      }
      // 1. Generate the rolling horizon from the CURRENT revision.
      const routineByWeekday = new Map<ScheduleWeekday, string | null>();
      for (const d of this.repos.schedule.getDays(schedule.id)) {
        if (d.enabled) routineByWeekday.set(d.weekday, d.routineId);
      }
      const horizonEnd = addDays(today, GENERATION_HORIZON_DAYS - 1);
      for (const date of datesBetween(today, horizonEnd)) {
        const weekday = isoWeekdayOf(date);
        if (!routineByWeekday.has(weekday)) continue;
        const created = this.repos.sessions.generateIfMissing({
          id: this.newId(),
          profileId,
          scheduledDate: date,
          routineId: routineByWeekday.get(weekday) ?? null,
          scheduleRevision: schedule.revision,
          now: this.now(),
        });
        if (created) report.generated += 1;
      }
      // 2. Pause overlay on pending sessions (unfinalized only; see header).
      //    Runs AFTER generation so sessions materializing inside a known
      //    pause are paused immediately.
      const pauses = this.repos.exceptions.listForProfile(profileId);
      if (pauses.length > 0) {
        for (const session of this.repos.sessions.forProfile(profileId)) {
          if (session.status !== "pending") continue;
          if (pauses.some((p) => session.scheduledDate >= p.startDate && session.scheduledDate <= p.endDate)) {
            this.repos.sessions.setStatus(session.id, "paused", this.now());
            report.paused += 1;
          }
        }
      }
      // 3. Miss resolution: only after the training-day window passed.
      if (!internal?.skipExpiry) {
        report.expired += this.resolveExpiredScheduledSessions(profileId, options);
      }
      return report;
    });
  }

  /** Pending sessions whose logical day definitively passed become missed. */
  resolveExpiredScheduledSessions(profileId: string, options: ScheduleClockOptions = {}): number {
    const today = this.todayLogical(options);
    let expired = 0;
    for (const session of this.repos.sessions.forProfile(profileId)) {
      if (session.status === "pending" && session.scheduledDate < today) {
        this.repos.sessions.setStatus(session.id, "missed", this.now());
        expired += 1;
      }
    }
    return expired;
  }

  private cancelPendingFrom(profileId: string, fromDate: string): number {
    let cancelled = 0;
    for (const session of this.repos.sessions.pendingFrom(profileId, fromDate)) {
      this.repos.sessions.setStatus(session.id, "cancelled", this.now());
      cancelled += 1;
    }
    return cancelled;
  }

  // ---------------------------------------------------------- rescheduling --

  /**
   * Move a pending future/current obligation to another date in the SAME ISO
   * week (spec U/V). The original becomes 'rescheduled' (inert) and exactly
   * one new active obligation is created. Rejected: non-pending sources,
   * other weeks, past dates, occupied target dates.
   */
  rescheduleSession(sessionId: string, newDate: string, options: ScheduleClockOptions = {}): ScheduledSession {
    return this.driver.transaction(() => {
      const source = this.repos.sessions.getById(sessionId);
      if (!source) throw new RescheduleError("scheduled session not found");
      if (source.status !== "pending") {
        throw new RescheduleError("only pending sessions can be rescheduled (status: " + source.status + ")");
      }
      const today = this.todayLogical(options);
      if (newDate < today) throw new RescheduleError("cannot reschedule into the past");
      if (isoWeekKey(newDate) !== isoWeekKey(source.scheduledDate)) {
        throw new RescheduleError("rescheduling is restricted to the same ISO week");
      }
      if (this.repos.sessions.activeForDate(source.profileId, newDate)) {
        throw new RescheduleError("target date already has a scheduled session");
      }
      const ts = this.now();
      this.repos.sessions.setStatus(source.id, "rescheduled", ts);
      const created = this.repos.sessions.generateIfMissing({
        id: this.newId(),
        profileId: source.profileId,
        scheduledDate: newDate,
        originalDate: source.originalDate,
        routineId: source.routineId,
        scheduleRevision: source.scheduleRevision,
        now: ts,
        rescheduledFromDate: source.scheduledDate,
      });
      if (!created) throw new RescheduleError("target date already has a scheduled session");
      this.streakDirty?.mark(source.profileId, "schedule", source.id, "session_rescheduled");
      return this.repos.sessions.activeForDate(source.profileId, newDate)!;
    });
  }

  // ------------------------------------------------------------- pauses --

  addPause(
    profileId: string,
    startDate: string,
    endDate: string,
    reason: string | null,
    // Clock options kept for interface symmetry; pauses are pure calendar
    // ranges, and the documented no-retroactive-rescue rule is enforced by
    // resolveExpiredScheduledSessions ordering, not by date validation here.
    _options: ScheduleClockOptions = {},
  ): ScheduleException {
    if (endDate < startDate) throw new SchedulePauseOverlapError();
    return this.driver.transaction(() => {
      this.repos.schedule.ensureDefault(profileId);
      for (const existing of this.repos.exceptions.listForProfile(profileId)) {
        if (startDate <= existing.endDate && endDate >= existing.startDate) {
          throw new SchedulePauseOverlapError();
        }
      }
      const exception = this.repos.exceptions.add({
        profileId, startDate, endDate, type: "pause", reason, now: this.now(),
      });
      // Pause overlay (pending only - finalized misses are immutable).
      for (const session of this.repos.sessions.forProfile(profileId)) {
        if (session.status === "pending" && session.scheduledDate >= startDate && session.scheduledDate <= endDate) {
          this.repos.sessions.setStatus(session.id, "paused", this.now());
        }
      }
      this.streakDirty?.mark(profileId, "exception", exception.id, "exception_changed");
      return exception;
    });
  }

  /**
   * Remove a pause that has not fully elapsed. Paused sessions from today's
   * logical day onward return to pending (and resolve normally again).
   * Fully elapsed pauses are history and cannot be removed (spec AZ).
   */
  removeFuturePause(exceptionId: string, options: ScheduleClockOptions = {}): boolean {
    return this.driver.transaction(() => {
      const exception = this.repos.exceptions.getById(exceptionId);
      if (!exception) return false;
      const today = this.todayLogical(options);
      if (exception.endDate < today) throw new RescheduleError("a fully elapsed pause is history and cannot be removed");
      this.repos.exceptions.remove(exceptionId);
      const reopenFrom = exception.startDate > today ? exception.startDate : today;
      const reopenTo = exception.endDate;
      for (const session of this.repos.sessions.forProfile(exception.profileId)) {
        if (
          session.status === "paused" &&
          session.scheduledDate >= reopenFrom &&
          session.scheduledDate <= reopenTo
        ) {
          this.repos.sessions.setStatus(session.id, "pending", this.now());
        }
      }
      this.streakDirty?.mark(exception.profileId, "exception", exceptionId, "exception_changed");
      return true;
    });
  }

  listPauses(profileId: string): ScheduleException[] {
    return this.repos.exceptions.listForProfile(profileId);
  }

  // ------------------------------------------------------------- reads --

  getUpcomingSessions(profileId: string, options: ScheduleClockOptions = {}): ScheduledSession[] {
    return this.repos.sessions.pendingFrom(profileId, this.todayLogical(options));
  }

  getWeekState(profileId: string, options: ScheduleClockOptions = {}): WeekDayState[] {
    const monday = startOfIsoWeek(this.todayLogical(options));
    const out: WeekDayState[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(monday, i);
      const weekday = ((i + 1) as ScheduleWeekday);
      const active = this.repos.sessions.activeForDate(profileId, date);
      const movedSource = this.repos.sessions.forDate(profileId, date).find((s) => s.status === "rescheduled");
      const session = active ?? movedSource ?? null;
      out.push({
        date,
        weekday,
        state: session == null
          ? "rest"
          : session.status === "pending"
            ? "planned"
            : session.status === "completed"
              ? "completed"
              : session.status === "missed"
                ? "missed"
                : session.status === "paused"
                  ? "paused"
                  : "rescheduled",
        sessionId: session?.id ?? null,
        workoutId: session?.workoutId ?? null,
        routineId: session?.routineId ?? null,
      });
    }
    return out;
  }
}