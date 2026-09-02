/** Phase 6 test helpers: deterministic clock + schedule/streak scenarios. */

import type { ScheduledSession } from "@openrank/domain";
import { deterministicRepos, openTestFileDb, cleanupFileDb, type TestFileDb } from "../testing/helpers";
import { createServices } from "../services";
import type { OpenRankServices } from "../services";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";

export { openTestFileDb, cleanupFileDb };

export interface Ctx {
  driver: DatabaseDriver;
  repos: OpenDatabaseResult;
  services: OpenRankServices;
  profileId: string;
}

/** Fixed wall clock (defaults to 2026-02-12T12:00Z, a Thursday). */
export function fixedClock(at?: string): () => string {
  return () => at ?? "2026-02-12T12:00:00.000Z";
}

export function setup(nowAt?: string): Ctx {
  const db = deterministicRepos();
  const services = createServices(db.driver, db.repos, { now: fixedClock(nowAt) });
  const profile = db.repos.profile.ensureDefault();
  return { driver: db.driver, repos: db.repos, services, profileId: profile.id };
}

/** Noon UTC on a date string: with offset 0 the logical day equals the date. */
export function noon(dateStr: string): string {
  return dateStr + "T12:00:00.000Z";
}

/** 22:00 UTC on a date string (same logical day at offset 0). */
export function evening(dateStr: string): string {
  return dateStr + "T22:00:00.000Z";
}

export interface ScheduleSetup {
  weekdays: number[];
  routineByWeekday?: Record<number, string>;
  enabled?: boolean;
}

/** Configure + enable the weekly schedule (all other days disabled). */
export function configureSchedule(ctx: Ctx, spec: ScheduleSetup): void {
  const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    enabled: spec.weekdays.includes(weekday),
    routineId: spec.routineByWeekday ? spec.routineByWeekday[weekday] ?? null : null,
  }));
  ctx.services.schedule.updateWeeklySchedule(ctx.profileId, days);
  if (spec.enabled !== false) {
    ctx.services.schedule.setScheduleEnabled(ctx.profileId, true);
  }
}

/** Create + finish a workout (one bench set) whose logical day is the date. */
export function completeWorkoutOn(
  ctx: Ctx,
  date: string,
  opts: { atUtc?: string; offset?: number; exerciseAlias?: string; weightKg?: number; reps?: number } = {},
): string {
  const startedAt = opts.atUtc ?? noon(date);
  const offset = opts.offset ?? 0;
  const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, {
    startedAtUtc: startedAt,
    timezoneOffsetMinutes: offset,
  });
  const exerciseId = ctx.repos.exercise.resolveAlias(opts.exerciseAlias ?? "Bench Press (Barbell)")!.id;
  const we = ctx.repos.workout.addExercise(w.id, { exerciseId, restSeconds: 0 });
  ctx.services.workout.addSet(we.id, {
    setType: "normal",
    weightKg: opts.weightKg ?? 60,
    reps: opts.reps ?? 5,
  }, startedAt);
  ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: startedAt, incompleteSetPolicy: "remove" });
  return w.id;
}

export function reconcile(ctx: Ctx, todayUtc: string, offset?: number) {
  return ctx.services.schedule.reconcileUpcomingSessions(ctx.profileId, {
    todayUtc,
    timezoneOffsetMinutes: offset ?? 0,
  });
}

export function processStreak(ctx: Ctx, todayUtc: string, offset?: number) {
  return ctx.services.streak.processPending({ todayUtc, timezoneOffsetMinutes: offset ?? 0 });
}

/** scheduled_date -> sessions on that date (any status). */
export function sessionsByDate(ctx: Ctx): Map<string, ScheduledSession[]> {
  const map = new Map<string, ScheduledSession[]>();
  for (const s of ctx.repos.scheduledSessions.forProfile(ctx.profileId)) {
    const bucket = map.get(s.scheduledDate) ?? [];
    bucket.push(s);
    map.set(s.scheduledDate, bucket);
  }
  return map;
}

export function cacheOf(ctx: Ctx) {
  return ctx.repos.streakCache.get(ctx.profileId)!;
}

export function eventKeys(ctx: Ctx): string[] {
  return ctx.repos.streakEvents.listForProfile(ctx.profileId).map((e) => e.type + ":" + e.key).sort();
}

/** Open a FILE-backed database with the same services (restart tests). */
export function setupFile(nowAt?: string): TestFileDb & { services: OpenRankServices; profileId: string } {
  const db = openTestFileDb();
  const services = createServices(db.driver, db.repos, { now: fixedClock(nowAt) });
  const profile = db.repos.profile.ensureDefault();
  return { ...db, services, profileId: profile.id };
}
