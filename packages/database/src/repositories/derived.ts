/**
 * Derived-state repositories (Phase 5): personal records, PR events, rank
 * snapshots, rank events. These are CACHE stores - every write path is owned
 * by the DerivedDataWorker; UI/services only read through them.
 *
 * Provenance columns are plain TEXT (no FK): see docs/DERIVED_STATE.md -
 * canonical deletions never cascade into projections; a rebuild restores
 * consistency instead.
 */

import type {
  PersonalRecord,
  PersonalRecordEvent,
  PersonalRecordRepository,
  RankDirection,
  RankEvent,
  RankEventRepository,
  RankScopeType,
  RankSnapshot,
  RankSnapshotRepository,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";

type Row = Record<string, unknown>;

function mapPersonalRecord(row: Row): PersonalRecord {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    exerciseId: String(row.exercise_id),
    recordType: String(row.record_type) as PersonalRecord["recordType"],
    qualifierKey: String(row.qualifier_key ?? ""),
    value: Number(row.value),
    sourceReps: row.source_reps == null ? null : Number(row.source_reps),
    sourceSetId: String(row.source_set_id),
    sourceWorkoutId: String(row.source_workout_id),
    achievedAt: String(row.achieved_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPersonalRecordEvent(row: Row): PersonalRecordEvent {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    exerciseId: String(row.exercise_id),
    recordType: String(row.record_type) as PersonalRecordEvent["recordType"],
    qualifierKey: String(row.qualifier_key ?? ""),
    previousValue: row.previous_value == null ? null : Number(row.previous_value),
    value: Number(row.value),
    sourceSetId: String(row.source_set_id),
    sourceWorkoutId: String(row.source_workout_id),
    achievedAt: String(row.achieved_at),
    createdAt: String(row.created_at),
  };
}

function mapRankSnapshot(row: Row): RankSnapshot {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    scopeType: String(row.scope_type) as RankScopeType,
    scopeKey: String(row.scope_key),
    tierIndex: Number(row.tier_index),
    tierName: String(row.tier_name),
    division: row.division == null ? null : String(row.division),
    score: Number(row.score),
    progress: row.progress == null ? null : Number(row.progress),
    rankingVersion: String(row.ranking_version),
    projectionVersion: String(row.projection_version),
    calculatedAt: String(row.calculated_at),
    sourceWorkoutId: String(row.source_workout_id),
    detailsJson: String(row.details_json),
  };
}

function mapRankEvent(row: Row): RankEvent {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    scopeType: String(row.scope_type) as RankScopeType,
    scopeKey: String(row.scope_key),
    fromTierIndex: row.from_tier_index == null ? null : Number(row.from_tier_index),
    fromTier: row.from_tier == null ? null : String(row.from_tier),
    fromDivision: row.from_division == null ? null : String(row.from_division),
    toTierIndex: Number(row.to_tier_index),
    toTier: String(row.to_tier),
    toDivision: row.to_division == null ? null : String(row.to_division),
    direction: String(row.direction) as RankDirection,
    score: Number(row.score),
    rankingVersion: String(row.ranking_version),
    projectionVersion: String(row.projection_version),
    sourceWorkoutId: String(row.source_workout_id),
    createdAt: String(row.created_at),
  };
}

export class SqlitePersonalRecordRepository implements PersonalRecordRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  best(
    profileId: string,
    exerciseId: string,
    recordType: PersonalRecord["recordType"],
    qualifierKey: string,
  ): PersonalRecord | null {
    const row = this.driver.get(
      "SELECT * FROM personal_records WHERE profile_id = ? AND exercise_id = ? " +
        "AND record_type = ? AND qualifier_key = ?",
      [profileId, exerciseId, recordType, qualifierKey],
    );
    return row ? mapPersonalRecord(row) : null;
  }

  upsertBest(record: PersonalRecord): "inserted" | "updated" | "unchanged" {
    const existing = this.best(record.profileId, record.exerciseId, record.recordType, record.qualifierKey);
    if (!existing) {
      this.driver.run(
        "INSERT INTO personal_records (id, profile_id, exercise_id, record_type, qualifier_key, value, " +
          "source_reps, source_set_id, source_workout_id, achieved_at, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          record.id, record.profileId, record.exerciseId, record.recordType, record.qualifierKey,
          record.value, record.sourceReps, record.sourceSetId, record.sourceWorkoutId,
          record.achievedAt, record.createdAt, record.updatedAt,
        ],
      );
      return "inserted";
    }
    // Strictly better only: an equal repeat never replaces provenance.
    if (record.value > existing.value + 1e-9) {
      this.driver.run(
        "UPDATE personal_records SET value = ?, source_reps = ?, source_set_id = ?, " +
          "source_workout_id = ?, achieved_at = ?, updated_at = ? " +
          "WHERE profile_id = ? AND exercise_id = ? AND record_type = ? AND qualifier_key = ?",
        [
          record.value, record.sourceReps, record.sourceSetId, record.sourceWorkoutId,
          record.achievedAt, record.updatedAt,
          record.profileId, record.exerciseId, record.recordType, record.qualifierKey,
        ],
      );
      return "updated";
    }
    return "unchanged";
  }

  listForExercise(profileId: string, exerciseId: string): PersonalRecord[] {
    return this.driver
      .all(
        "SELECT * FROM personal_records WHERE profile_id = ? AND exercise_id = ? " +
          "ORDER BY record_type, qualifier_key",
        [profileId, exerciseId],
      )
      .map(mapPersonalRecord);
  }

  listForProfile(profileId: string): PersonalRecord[] {
    return this.driver
      .all("SELECT * FROM personal_records WHERE profile_id = ? ORDER BY exercise_id, record_type, qualifier_key", [profileId])
      .map(mapPersonalRecord);
  }

  replaceAllForProfile(profileId: string, records: readonly PersonalRecord[]): void {
    this.driver.run("DELETE FROM personal_records WHERE profile_id = ?", [profileId]);
    for (const r of records) {
      this.driver.run(
        "INSERT INTO personal_records (id, profile_id, exercise_id, record_type, qualifier_key, value, " +
          "source_reps, source_set_id, source_workout_id, achieved_at, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          r.id, r.profileId, r.exerciseId, r.recordType, r.qualifierKey,
          r.value, r.sourceReps, r.sourceSetId, r.sourceWorkoutId,
          r.achievedAt, r.createdAt, r.updatedAt,
        ],
      );
    }
  }

  appendEvent(event: PersonalRecordEvent): void {
    // UNIQUE(profile, exercise, type, qualifier, source_set): one event per
    // record-setting set - retries and re-walks can never duplicate history.
    this.driver.run(
      "INSERT OR IGNORE INTO personal_record_events (id, profile_id, exercise_id, record_type, qualifier_key, " +
        "previous_value, value, source_set_id, source_workout_id, achieved_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        event.id, event.profileId, event.exerciseId, event.recordType, event.qualifierKey,
        event.previousValue, event.value, event.sourceSetId, event.sourceWorkoutId,
        event.achievedAt, event.createdAt,
      ],
    );
  }

  replaceAllEventsForProfile(profileId: string, events: readonly PersonalRecordEvent[]): void {
    this.driver.run("DELETE FROM personal_record_events WHERE profile_id = ?", [profileId]);
    for (const e of events) {
      this.driver.run(
        "INSERT INTO personal_record_events (id, profile_id, exercise_id, record_type, qualifier_key, " +
          "previous_value, value, source_set_id, source_workout_id, achieved_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          e.id, e.profileId, e.exerciseId, e.recordType, e.qualifierKey,
          e.previousValue, e.value, e.sourceSetId, e.sourceWorkoutId,
          e.achievedAt, e.createdAt,
        ],
      );
    }
  }

  listEventsForExercise(profileId: string, exerciseId: string, limit = 50): PersonalRecordEvent[] {
    return this.driver
      .all(
        "SELECT * FROM personal_record_events WHERE profile_id = ? AND exercise_id = ? " +
          "ORDER BY achieved_at DESC, rowid DESC LIMIT " + String(Math.max(0, Math.floor(limit))),
        [profileId, exerciseId],
      )
      .map(mapPersonalRecordEvent);
  }

  listEventsForWorkout(workoutId: string): PersonalRecordEvent[] {
    return this.driver
      .all(
        "SELECT * FROM personal_record_events WHERE source_workout_id = ? ORDER BY achieved_at, rowid",
        [workoutId],
      )
      .map(mapPersonalRecordEvent);
  }
}

export class SqliteRankSnapshotRepository implements RankSnapshotRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  latest(profileId: string, scopeType: RankScopeType, scopeKey: string): RankSnapshot | null {
    // Insert order is chronological; MAX(rowid) is the newest per scope.
    const row = this.driver.get(
      "SELECT * FROM rank_snapshots WHERE profile_id = ? AND scope_type = ? AND scope_key = ? " +
        "ORDER BY rowid DESC LIMIT 1",
      [profileId, scopeType, scopeKey],
    );
    return row ? mapRankSnapshot(row) : null;
  }

  latestForProfile(profileId: string): RankSnapshot[] {
    return this.driver
      .all(
        "SELECT s.* FROM rank_snapshots s " +
          "JOIN (SELECT scope_type, scope_key, MAX(rowid) AS mr FROM rank_snapshots " +
          "      WHERE profile_id = ? GROUP BY scope_type, scope_key) t " +
          "ON s.rowid = t.mr " +
          "ORDER BY s.scope_type, s.scope_key",
        [profileId],
      )
      .map(mapRankSnapshot);
  }

  history(profileId: string, scopeType: RankScopeType, scopeKey: string): RankSnapshot[] {
    return this.driver
      .all(
        "SELECT * FROM rank_snapshots WHERE profile_id = ? AND scope_type = ? AND scope_key = ? " +
          "ORDER BY rowid",
        [profileId, scopeType, scopeKey],
      )
      .map(mapRankSnapshot);
  }

  upsert(snapshot: RankSnapshot): void {
    // Re-derivation with changed inputs replaces the same (scope, workout)
    // row wholesale - idempotent and never duplicated.
    this.driver.run("DELETE FROM rank_snapshots WHERE profile_id = ? AND scope_type = ? AND scope_key = ? AND source_workout_id = ?", [
      snapshot.profileId, snapshot.scopeType, snapshot.scopeKey, snapshot.sourceWorkoutId,
    ]);
    this.driver.run(
      "INSERT INTO rank_snapshots (id, profile_id, scope_type, scope_key, tier_index, tier_name, division, " +
        "score, progress, ranking_version, projection_version, calculated_at, source_workout_id, details_json) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        snapshot.id, snapshot.profileId, snapshot.scopeType, snapshot.scopeKey,
        snapshot.tierIndex, snapshot.tierName, snapshot.division, snapshot.score, snapshot.progress,
        snapshot.rankingVersion, snapshot.projectionVersion, snapshot.calculatedAt,
        snapshot.sourceWorkoutId, snapshot.detailsJson,
      ],
    );
  }

  replaceAllForProfile(profileId: string, snapshots: readonly RankSnapshot[]): void {
    this.driver.run("DELETE FROM rank_snapshots WHERE profile_id = ?", [profileId]);
    for (const s of snapshots) {
      this.driver.run(
        "INSERT INTO rank_snapshots (id, profile_id, scope_type, scope_key, tier_index, tier_name, division, " +
          "score, progress, ranking_version, projection_version, calculated_at, source_workout_id, details_json) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          s.id, s.profileId, s.scopeType, s.scopeKey,
          s.tierIndex, s.tierName, s.division, s.score, s.progress,
          s.rankingVersion, s.projectionVersion, s.calculatedAt,
          s.sourceWorkoutId, s.detailsJson,
        ],
      );
    }
  }
}

export class SqliteRankEventRepository implements RankEventRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  append(event: RankEvent): void {
    // UNIQUE(profile, scope, source_workout): one transition per workout per
    // scope; re-derivation replaces (never duplicates).
    this.driver.run(
      "INSERT OR REPLACE INTO rank_events (id, profile_id, scope_type, scope_key, from_tier_index, from_tier, " +
        "from_division, to_tier_index, to_tier, to_division, direction, score, ranking_version, " +
        "projection_version, source_workout_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        event.id, event.profileId, event.scopeType, event.scopeKey,
        event.fromTierIndex, event.fromTier, event.fromDivision,
        event.toTierIndex, event.toTier, event.toDivision,
        event.direction, event.score, event.rankingVersion, event.projectionVersion,
        event.sourceWorkoutId, event.createdAt,
      ],
    );
  }

  historyForScope(profileId: string, scopeType: RankScopeType, scopeKey: string): RankEvent[] {
    return this.driver
      .all(
        "SELECT * FROM rank_events WHERE profile_id = ? AND scope_type = ? AND scope_key = ? " +
          "ORDER BY created_at, rowid",
        [profileId, scopeType, scopeKey],
      )
      .map(mapRankEvent);
  }

  listForProfile(profileId: string, limit = 30): RankEvent[] {
    return this.driver
      .all(
        "SELECT * FROM rank_events WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT " +
          String(Math.max(0, Math.floor(limit))),
        [profileId],
      )
      .map(mapRankEvent);
  }

  listForWorkout(workoutId: string): RankEvent[] {
    return this.driver
      .all("SELECT * FROM rank_events WHERE source_workout_id = ? ORDER BY rowid", [workoutId])
      .map(mapRankEvent);
  }

  replaceAllForProfile(profileId: string, events: readonly RankEvent[]): void {
    this.driver.run("DELETE FROM rank_events WHERE profile_id = ?", [profileId]);
    for (const e of events) {
      this.driver.run(
        "INSERT INTO rank_events (id, profile_id, scope_type, scope_key, from_tier_index, from_tier, " +
          "from_division, to_tier_index, to_tier, to_division, direction, score, ranking_version, " +
          "projection_version, source_workout_id, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          e.id, e.profileId, e.scopeType, e.scopeKey,
          e.fromTierIndex, e.fromTier, e.fromDivision,
          e.toTierIndex, e.toTier, e.toDivision,
          e.direction, e.score, e.rankingVersion, e.projectionVersion,
          e.sourceWorkoutId, e.createdAt,
        ],
      );
    }
  }

  countForProfile(profileId: string): number {
    const row = this.driver.get("SELECT COUNT(*) AS n FROM rank_events WHERE profile_id = ?", [profileId]);
    return Number(row?.n ?? 0);
  }
}