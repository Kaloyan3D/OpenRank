/**
 * Rest timer persistence (Phase 4).
 *
 * One row per profile (upsert). The authoritative state is the absolute
 * `ends_at` instant - the visible countdown is always derived as
 * `ends_at - now`, so the timer keeps running across backgrounding,
 * navigation and process restarts without storing a ticking counter.
 */

import type { RestTimerRepository, RestTimerStartInput, RestTimerState } from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { nowUtc } from "../rows";

interface TimerRow {
  profile_id: unknown;
  workout_id: unknown;
  workout_exercise_id: unknown;
  started_at: unknown;
  ends_at: unknown;
  duration_seconds: unknown;
}

export class SqliteRestTimerRepository implements RestTimerRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  start(profileId: string, input: RestTimerStartInput): void {
    if (!(input.durationSeconds > 0) || !Number.isFinite(input.durationSeconds)) {
      throw new Error("rest duration must be a positive number of seconds");
    }
    this.driver.run(
      "INSERT INTO rest_timer (profile_id, workout_id, workout_exercise_id, started_at, ends_at, duration_seconds, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(profile_id) DO UPDATE SET workout_id = excluded.workout_id, " +
        "workout_exercise_id = excluded.workout_exercise_id, started_at = excluded.started_at, " +
        "ends_at = excluded.ends_at, duration_seconds = excluded.duration_seconds, updated_at = excluded.updated_at",
      [
        profileId,
        input.workoutId,
        input.workoutExerciseId ?? null,
        input.startedAtUtc,
        addSeconds(input.startedAtUtc, input.durationSeconds),
        Math.round(input.durationSeconds),
        nowUtc(),
      ],
    );
  }

  adjustEnd(profileId: string, deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds)) throw new Error("delta must be finite");
    const row = this.driver.get("SELECT ends_at FROM rest_timer WHERE profile_id = ?", [profileId]) as
      | { ends_at: unknown }
      | undefined;
    if (!row) return; // nothing to adjust
    this.driver.run(
      "UPDATE rest_timer SET ends_at = ?, updated_at = ? WHERE profile_id = ?",
      [addSeconds(String(row.ends_at), deltaSeconds), nowUtc(), profileId],
    );
  }

  get(profileId: string, nowUtcIso: string): RestTimerState | null {
    const row = this.driver.get("SELECT * FROM rest_timer WHERE profile_id = ?", [profileId]) as
      | TimerRow
      | undefined;
    if (!row) return null;
    const endsAt = String(row.ends_at);
    const remainingMs = Date.parse(endsAt) - Date.parse(nowUtcIso);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    return {
      profileId,
      workoutId: String(row.workout_id),
      workoutExerciseId: row.workout_exercise_id == null ? null : String(row.workout_exercise_id),
      startedAt: String(row.started_at),
      endsAt,
      durationSeconds: Number(row.duration_seconds),
      remainingSeconds,
      expired: remainingMs <= 0,
    };
  }

  clear(profileId: string): void {
    this.driver.run("DELETE FROM rest_timer WHERE profile_id = ?", [profileId]);
  }

  clearIfWorkout(profileId: string, workoutId: string): void {
    this.driver.run(
      "DELETE FROM rest_timer WHERE profile_id = ? AND workout_id = ?",
      [profileId, workoutId],
    );
  }
}

/** ISO-8601 instant + N seconds, tolerant of fractional seconds. */
function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}
