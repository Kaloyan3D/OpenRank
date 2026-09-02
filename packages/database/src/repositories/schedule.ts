/**
 * Schedule + streak repositories (Phase 6).
 *
 * scheduled_sessions is the historical attendance ledger and the ONLY truth
 * for streak calculations; streak_cache/streak_events are rebuildable
 * projections; streak_dirty is the dedicated repair queue (spec S option B).
 */

import type {
  ScheduleException,
  ScheduleExceptionRepository,
  ScheduleExceptionType,
  ScheduleWeekday,
  ScheduledSession,
  ScheduledSessionRepository,
  ScheduledSessionStatus,
  StreakCache,
  StreakCacheRepository,
  StreakDirtyReason,
  StreakDirtyRecord,
  StreakDirtyRepository,
  StreakDirtyEntityType,
  StreakEvent,
  StreakEventRepository,
  StreakEventType,
  TrainingSchedule,
  TrainingScheduleDay,
  TrainingScheduleRepository,
} from "@openrank/domain";
import type { DatabaseDriver, SqlRow } from "../driver";

const now = (): string => new Date().toISOString();

function mapSchedule(row: SqlRow): TrainingSchedule {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    enabled: row.enabled === 1,
    dayBoundaryMinutes: Number(row.day_boundary_minutes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revision: Number(row.revision),
  };
}

function mapDay(row: SqlRow): TrainingScheduleDay {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    weekday: Number(row.weekday) as ScheduleWeekday,
    enabled: row.enabled === 1,
    routineId: row.routine_id == null ? null : String(row.routine_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSession(row: SqlRow): ScheduledSession {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    originalDate: String(row.original_date),
    scheduledDate: String(row.scheduled_date),
    routineId: row.routine_id == null ? null : String(row.routine_id),
    status: String(row.status) as ScheduledSessionStatus,
    scheduleRevision: Number(row.schedule_revision),
    workoutId: row.workout_id == null ? null : String(row.workout_id),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
    rescheduledFromDate: row.rescheduled_from_date == null ? null : String(row.rescheduled_from_date),
    streakAfter: row.streak_after == null ? null : Number(row.streak_after),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapException(row: SqlRow): ScheduleException {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    type: String(row.type) as ScheduleExceptionType,
    reason: row.reason == null ? null : String(row.reason),
    createdAt: String(row.created_at),
  };
}

function mapStreakCache(row: SqlRow): StreakCache {
  return {
    profileId: String(row.profile_id),
    currentStreak: Number(row.current_streak),
    bestStreak: Number(row.best_streak),
    perfectWeeks: Number(row.perfect_weeks),
    lastCompletedSessionId: row.last_completed_session_id == null ? null : String(row.last_completed_session_id),
    recalculatedAt: row.recalculated_at == null ? null : String(row.recalculated_at),
  };
}

function mapStreakEvent(row: SqlRow): StreakEvent {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    type: String(row.type) as StreakEventType,
    key: String(row.key),
    value: Number(row.value),
    occurredAt: String(row.occurred_at),
    createdAt: String(row.created_at),
  };
}

function mapStreakDirty(row: SqlRow): StreakDirtyRecord {
  return {
    id: String(row.id),
    profileId: row.profile_id == null ? null : String(row.profile_id),
    entityType: String(row.entity_type) as StreakDirtyEntityType,
    entityId: String(row.entity_id),
    reason: String(row.reason) as StreakDirtyReason,
    createdAt: String(row.created_at),
  };
}

export class SqliteTrainingScheduleRepository implements TrainingScheduleRepository {
  constructor(private readonly driver: DatabaseDriver, private readonly newId: () => string) {}

  getForProfile(profileId: string): TrainingSchedule | null {
    const row = this.driver.get("SELECT * FROM training_schedules WHERE profile_id = ?", [profileId]);
    return row ? mapSchedule(row) : null;
  }

  ensureDefault(profileId: string): TrainingSchedule {
    const existing = this.getForProfile(profileId);
    if (existing) return existing;
    const ts = now();
    const id = this.newId();
    this.driver.run(
      "INSERT INTO training_schedules (id, profile_id, enabled, day_boundary_minutes, created_at, updated_at, revision) VALUES (?, ?, 0, 240, ?, ?, 1)",
      [id, profileId, ts, ts],
    );
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      this.upsertDay(id, { weekday: weekday as ScheduleWeekday, enabled: false, routineId: null });
    }
    return this.getForProfile(profileId)!;
  }

  setEnabled(scheduleId: string, enabled: boolean): void {
    this.driver.run(
      "UPDATE training_schedules SET enabled = ?, updated_at = ? WHERE id = ?",
      [enabled ? 1 : 0, now(), scheduleId],
    );
  }

  bumpRevision(scheduleId: string): number {
    this.driver.run(
      "UPDATE training_schedules SET revision = revision + 1, updated_at = ? WHERE id = ?",
      [now(), scheduleId],
    );
    const row = this.driver.get("SELECT revision FROM training_schedules WHERE id = ?", [scheduleId]);
    return Number(row?.revision ?? 0);
  }

  getDays(scheduleId: string): TrainingScheduleDay[] {
    return this.driver
      .all("SELECT * FROM training_schedule_days WHERE schedule_id = ? ORDER BY weekday", [scheduleId])
      .map(mapDay);
  }

  upsertDay(scheduleId: string, day: { weekday: ScheduleWeekday; enabled: boolean; routineId: string | null }): void {
    const existing = this.driver.get(
      "SELECT id FROM training_schedule_days WHERE schedule_id = ? AND weekday = ?",
      [scheduleId, day.weekday],
    );
    const ts = now();
    if (existing) {
      this.driver.run(
        "UPDATE training_schedule_days SET enabled = ?, routine_id = ?, updated_at = ? WHERE id = ?",
        [day.enabled ? 1 : 0, day.routineId, ts, String(existing.id)],
      );
    } else {
      this.driver.run(
        "INSERT INTO training_schedule_days (id, schedule_id, weekday, enabled, routine_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [this.newId(), scheduleId, day.weekday, day.enabled ? 1 : 0, day.routineId, ts, ts],
      );
    }
  }

  replaceAllForProfile(profileId: string, schedule: TrainingSchedule | null, days: readonly TrainingScheduleDay[]): void {
    this.driver.run("DELETE FROM training_schedules WHERE profile_id = ?", [profileId]);
    if (!schedule) return;
    this.driver.run(
      "INSERT INTO training_schedules (id, profile_id, enabled, day_boundary_minutes, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [schedule.id, profileId, schedule.enabled ? 1 : 0, schedule.dayBoundaryMinutes, schedule.createdAt, schedule.updatedAt, schedule.revision],
    );
    for (const d of days) {
      this.driver.run(
        "INSERT INTO training_schedule_days (id, schedule_id, weekday, enabled, routine_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [d.id, d.scheduleId, d.weekday, d.enabled ? 1 : 0, d.routineId, d.createdAt, d.updatedAt],
      );
    }
  }
}

export class SqliteScheduledSessionRepository implements ScheduledSessionRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  getById(id: string): ScheduledSession | null {
    const row = this.driver.get("SELECT * FROM scheduled_sessions WHERE id = ?", [id]);
    return row ? mapSession(row) : null;
  }

  forWorkout(workoutId: string): ScheduledSession | null {
    const row = this.driver.get(
      "SELECT * FROM scheduled_sessions WHERE workout_id = ? ORDER BY scheduled_date LIMIT 1",
      [workoutId],
    );
    return row ? mapSession(row) : null;
  }

  forDate(profileId: string, scheduledDate: string): ScheduledSession[] {
    return this.driver
      .all(
        "SELECT * FROM scheduled_sessions WHERE profile_id = ? AND scheduled_date = ? ORDER BY id",
        [profileId, scheduledDate],
      )
      .map(mapSession);
  }

  activeForDate(profileId: string, scheduledDate: string): ScheduledSession | null {
    const row = this.driver.get(
      "SELECT * FROM scheduled_sessions WHERE profile_id = ? AND scheduled_date = ? AND status IN ('pending', 'completed', 'missed', 'paused') ORDER BY id LIMIT 1",
      [profileId, scheduledDate],
    );
    return row ? mapSession(row) : null;
  }

  firstPendingOnDate(profileId: string, scheduledDate: string): ScheduledSession | null {
    const row = this.driver.get(
      "SELECT * FROM scheduled_sessions WHERE profile_id = ? AND scheduled_date = ? AND status = 'pending' ORDER BY id LIMIT 1",
      [profileId, scheduledDate],
    );
    return row ? mapSession(row) : null;
  }

  forProfile(profileId: string): ScheduledSession[] {
    return this.driver
      .all("SELECT * FROM scheduled_sessions WHERE profile_id = ? ORDER BY scheduled_date, id", [profileId])
      .map(mapSession);
  }

  pendingFrom(profileId: string, fromDate: string): ScheduledSession[] {
    return this.driver
      .all(
        "SELECT * FROM scheduled_sessions WHERE profile_id = ? AND status = 'pending' AND scheduled_date >= ? ORDER BY scheduled_date, id",
        [profileId, fromDate],
      )
      .map(mapSession);
  }

  generateIfMissing(session: {
    id: string;
    profileId: string;
    scheduledDate: string;
    routineId: string | null;
    scheduleRevision: number;
    now: string;
    originalDate?: string | undefined;
    rescheduledFromDate?: string | null | undefined;
  }): boolean {
    const result = this.driver.run(
      "INSERT OR IGNORE INTO scheduled_sessions (id, profile_id, original_date, scheduled_date, routine_id, status, schedule_revision, workout_id, completed_at, rescheduled_from_date, streak_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, NULL, ?, ?)",
      [
        session.id,
        session.profileId,
        session.originalDate ?? session.scheduledDate,
        session.scheduledDate,
        session.routineId,
        session.scheduleRevision,
        session.rescheduledFromDate ?? null,
        session.now,
        session.now,
      ],
    );
    return result.changes === 1;
  }

  setStatus(sessionId: string, status: ScheduledSessionStatus, nowTs: string): void {
    this.driver.run("UPDATE scheduled_sessions SET status = ?, updated_at = ? WHERE id = ?", [status, nowTs, sessionId]);
  }

  linkCompletion(sessionId: string, workoutId: string, completedAt: string, nowTs: string): void {
    this.driver.run(
      "UPDATE scheduled_sessions SET status = 'completed', workout_id = ?, completed_at = ?, updated_at = ? WHERE id = ?",
      [workoutId, completedAt, nowTs, sessionId],
    );
  }

  setStreakAfter(sessionId: string, streakAfter: number): void {
    this.driver.run("UPDATE scheduled_sessions SET streak_after = ? WHERE id = ?", [streakAfter, sessionId]);
  }

  replaceAllForProfile(profileId: string, sessions: readonly ScheduledSession[]): void {
    this.driver.run("DELETE FROM scheduled_sessions WHERE profile_id = ?", [profileId]);
    for (const s of sessions) {
      this.driver.run(
        "INSERT INTO scheduled_sessions (id, profile_id, original_date, scheduled_date, routine_id, status, schedule_revision, workout_id, completed_at, rescheduled_from_date, streak_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [s.id, s.profileId, s.originalDate, s.scheduledDate, s.routineId, s.status, s.scheduleRevision, s.workoutId, s.completedAt, s.rescheduledFromDate, s.streakAfter, s.createdAt, s.updatedAt],
      );
    }
  }

  countForProfile(profileId: string): number {
    const row = this.driver.get("SELECT COUNT(*) AS n FROM scheduled_sessions WHERE profile_id = ?", [profileId]);
    return Number(row?.n ?? 0);
  }
}

export class SqliteScheduleExceptionRepository implements ScheduleExceptionRepository {
  constructor(private readonly driver: DatabaseDriver, private readonly newId: () => string) {}

  getById(id: string): ScheduleException | null {
    const row = this.driver.get("SELECT * FROM schedule_exceptions WHERE id = ?", [id]);
    return row ? mapException(row) : null;
  }

  add(exception: { profileId: string; startDate: string; endDate: string; type: ScheduleExceptionType; reason: string | null; now: string }): ScheduleException {
    const id = this.newId();
    this.driver.run(
      "INSERT OR IGNORE INTO schedule_exceptions (id, profile_id, start_date, end_date, type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, exception.profileId, exception.startDate, exception.endDate, exception.type, exception.reason, exception.now],
    );
    return this.getById(id)!;
  }

  remove(id: string): void {
    this.driver.run("DELETE FROM schedule_exceptions WHERE id = ?", [id]);
  }

  listForProfile(profileId: string): ScheduleException[] {
    return this.driver
      .all("SELECT * FROM schedule_exceptions WHERE profile_id = ? ORDER BY start_date, id", [profileId])
      .map(mapException);
  }

  listOverlapping(profileId: string, date: string): ScheduleException[] {
    return this.driver
      .all(
        "SELECT * FROM schedule_exceptions WHERE profile_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date, id",
        [profileId, date, date],
      )
      .map(mapException);
  }

  replaceAllForProfile(profileId: string, exceptions: readonly ScheduleException[]): void {
    this.driver.run("DELETE FROM schedule_exceptions WHERE profile_id = ?", [profileId]);
    for (const e of exceptions) {
      this.driver.run(
        "INSERT INTO schedule_exceptions (id, profile_id, start_date, end_date, type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [e.id, e.profileId, e.startDate, e.endDate, e.type, e.reason, e.createdAt],
      );
    }
  }
}

export class SqliteStreakCacheRepository implements StreakCacheRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  get(profileId: string): StreakCache | null {
    const row = this.driver.get("SELECT * FROM streak_cache WHERE profile_id = ?", [profileId]);
    return row ? mapStreakCache(row) : null;
  }

  upsert(cache: StreakCache): void {
    this.driver.run(
      "INSERT INTO streak_cache (profile_id, current_streak, best_streak, perfect_weeks, last_completed_session_id, recalculated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET current_streak = excluded.current_streak, best_streak = excluded.best_streak, perfect_weeks = excluded.perfect_weeks, last_completed_session_id = excluded.last_completed_session_id, recalculated_at = excluded.recalculated_at",
      [cache.profileId, cache.currentStreak, cache.bestStreak, cache.perfectWeeks, cache.lastCompletedSessionId, cache.recalculatedAt],
    );
  }

  replaceAllForProfile(profileId: string, caches: readonly StreakCache[]): void {
    this.driver.run("DELETE FROM streak_cache WHERE profile_id = ?", [profileId]);
    for (const c of caches) this.upsert(c);
  }
}

export class SqliteStreakEventRepository implements StreakEventRepository {
  constructor(private readonly driver: DatabaseDriver, private readonly _newId: () => string) {}

  append(event: StreakEvent): void {
    this.driver.run(
      "INSERT OR IGNORE INTO streak_events (id, profile_id, type, key, value, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [event.id, event.profileId, event.type, event.key, event.value, event.occurredAt, event.createdAt],
    );
  }

  /** Stable-identity convenience used by rebuilds without pre-built ids. */
  appendGenerated(event: Omit<StreakEvent, "id">): void {
    this.append({ ...event, id: this._newId() });
  }

  byKey(profileId: string, type: StreakEventType, key: string): StreakEvent | null {
    const row = this.driver.get(
      "SELECT * FROM streak_events WHERE profile_id = ? AND type = ? AND key = ?",
      [profileId, type, key],
    );
    return row ? mapStreakEvent(row) : null;
  }

  listForProfile(profileId: string): StreakEvent[] {
    return this.driver
      .all("SELECT * FROM streak_events WHERE profile_id = ? ORDER BY occurred_at, id", [profileId])
      .map(mapStreakEvent);
  }

  listByType(profileId: string, type: StreakEventType): StreakEvent[] {
    return this.driver
      .all("SELECT * FROM streak_events WHERE profile_id = ? AND type = ? ORDER BY occurred_at, id", [profileId, type])
      .map(mapStreakEvent);
  }

  replaceAllForProfile(profileId: string, events: readonly StreakEvent[]): void {
    this.driver.run("DELETE FROM streak_events WHERE profile_id = ?", [profileId]);
    for (const e of events) this.append(e);
  }

  countForProfile(profileId: string): number {
    const row = this.driver.get("SELECT COUNT(*) AS n FROM streak_events WHERE profile_id = ?", [profileId]);
    return Number(row?.n ?? 0);
  }
}

export class SqliteStreakDirtyRepository implements StreakDirtyRepository {
  constructor(private readonly driver: DatabaseDriver, private readonly newId: () => string) {}

  mark(profileId: string | null, entityType: StreakDirtyEntityType, entityId: string, reason: StreakDirtyReason): void {
    this.driver.run(
      "INSERT OR IGNORE INTO streak_dirty (id, profile_id, entity_type, entity_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [this.newId(), profileId, entityType, entityId, reason, now()],
    );
  }

  list(profileId?: string | null): StreakDirtyRecord[] {
    if (profileId === undefined) {
      return this.driver.all("SELECT * FROM streak_dirty ORDER BY created_at, id").map(mapStreakDirty);
    }
    return this.driver
      .all("SELECT * FROM streak_dirty WHERE profile_id = ? OR profile_id IS NULL ORDER BY created_at, id", [profileId])
      .map(mapStreakDirty);
  }

  clear(ids: readonly string[]): void {
    for (const id of ids) this.driver.run("DELETE FROM streak_dirty WHERE id = ?", [id]);
  }

  clearAll(): void {
    this.driver.run("DELETE FROM streak_dirty");
  }

  count(): number {
    const row = this.driver.get("SELECT COUNT(*) AS n FROM streak_dirty");
    return Number(row?.n ?? 0);
  }
}