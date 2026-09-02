/**
 * Migration framework + schema v1.
 *
 * Policy (Phase 3):
 * - Every future schema modification is a new migration appended to
 *   MIGRATIONS; migrations are immutable once shipped.
 * - The applied schema version lives in PRAGMA user_version; the migrator
 *   applies pending migrations each in its own transaction and bumps the
 *   version inside the same transaction.
 * - No ORM auto-sync and no destructive development resets: an existing
 *   database only ever moves forward.
 */

import type { DatabaseDriver } from "./driver";

export const SCHEMA_VERSION = 5;

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

const V1_STATEMENTS: readonly string[] = [
  // --- profiles + bodyweight ---------------------------------------------
  `CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    strength_standard TEXT NOT NULL DEFAULT 'male'
      CHECK (strength_standard IN ('male', 'female')),
    unit_system TEXT NOT NULL DEFAULT 'metric'
      CHECK (unit_system IN ('metric', 'imperial')),
    onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE bodyweight_entries (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    measured_at TEXT NOT NULL,
    weight_kg REAL NOT NULL CHECK (weight_kg > 0),
    source TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, measured_at)
  )`,

  // --- exercise catalog (dataset-owned rows; user customs have is_custom=1)
  `CREATE TABLE muscles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    major_group TEXT NOT NULL
      CHECK (major_group IN ('legs', 'chest', 'back', 'shoulders', 'arms', 'core'))
  )`,

  `CREATE TABLE exercises (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('strength', 'cardio', 'mobility', 'other')),
    mechanic TEXT CHECK (mechanic IN ('compound', 'isolation') OR mechanic IS NULL),
    force TEXT CHECK (force IN ('push', 'pull', 'static') OR force IS NULL),
    equipment TEXT,
    tracking_type TEXT NOT NULL CHECK (
      tracking_type IN ('weight_reps', 'bodyweight_reps', 'bodyweight_weighted',
                        'bodyweight_assisted', 'reps_only', 'duration', 'distance_duration')
    ),
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
    source TEXT NOT NULL,
    source_id TEXT,
    ranking_eligibility TEXT NOT NULL
      CHECK (ranking_eligibility IN ('eligible', 'provisional', 'unsupported')),
    ranking_strategy TEXT NOT NULL
      CHECK (ranking_strategy IN ('template', 'keyword', 'curated', 'none')),
    ranking_group TEXT
      CHECK (ranking_group IN ('legs', 'chest', 'back', 'shoulders', 'arms', 'core')
             OR ranking_group IS NULL),
    ranking_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX idx_exercises_ranking ON exercises(ranking_eligibility)`,

  `CREATE TABLE exercise_muscles (
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    muscle_id TEXT NOT NULL REFERENCES muscles(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    PRIMARY KEY (exercise_id, muscle_id)
  )`,

  `CREATE INDEX idx_exercise_muscles_muscle ON exercise_muscles(muscle_id)`,

  `CREATE TABLE exercise_aliases (
    id TEXT PRIMARY KEY NOT NULL,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en',
    source TEXT NOT NULL,
    UNIQUE (normalized_alias)
  )`,

  `CREATE INDEX idx_exercise_aliases_exercise ON exercise_aliases(exercise_id)`,

  `CREATE TABLE exercise_instructions (
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    step TEXT NOT NULL,
    PRIMARY KEY (exercise_id, position)
  )`,

  `CREATE TABLE exercise_media (
    id TEXT PRIMARY KEY NOT NULL,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    local_path TEXT,
    remote_url TEXT,
    source TEXT NOT NULL,
    license TEXT,
    attribution TEXT
  )`,

  `CREATE INDEX idx_exercise_media_exercise ON exercise_media(exercise_id)`,

  // --- routines -----------------------------------------------------------
  `CREATE TABLE routines (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  )`,

  `CREATE INDEX idx_routines_profile ON routines(profile_id)`,

  `CREATE TABLE routine_exercises (
    id TEXT PRIMARY KEY NOT NULL,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    rest_seconds INTEGER,
    superset_group TEXT,
    notes TEXT,
    UNIQUE (routine_id, position)
  )`,

  `CREATE INDEX idx_routine_exercises_routine ON routine_exercises(routine_id, position)`,

  `CREATE TABLE routine_set_targets (
    id TEXT PRIMARY KEY NOT NULL,
    routine_exercise_id TEXT NOT NULL REFERENCES routine_exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    set_type TEXT NOT NULL CHECK (set_type IN ('warmup', 'normal', 'drop', 'failure', 'amrap')),
    target_reps_min INTEGER,
    target_reps_max INTEGER,
    target_weight_kg REAL,
    target_rpe REAL,
    target_rir REAL,
    UNIQUE (routine_exercise_id, position)
  )`,

  // --- workouts + sets (canonical user data; autosave-safe) ---------------
  `CREATE TABLE workouts (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discarded')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    start_local_date TEXT NOT NULL,
    logical_training_date TEXT NOT NULL,
    start_timezone_offset_minutes INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status != 'completed' OR finished_at IS NOT NULL)
  )`,

  `CREATE INDEX idx_workouts_started_at ON workouts(started_at)`,
  `CREATE INDEX idx_workouts_profile_status ON workouts(profile_id, status)`,
  `CREATE UNIQUE INDEX idx_workouts_single_active ON workouts(profile_id) WHERE status = 'active'`,

  `CREATE TABLE workout_exercises (
    id TEXT PRIMARY KEY NOT NULL,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    rest_seconds INTEGER,
    superset_group TEXT,
    notes TEXT
  )`,

  `CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id, position)`,

  `CREATE TABLE workout_sets (
    id TEXT PRIMARY KEY NOT NULL,
    workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    set_type TEXT NOT NULL DEFAULT 'normal' CHECK (set_type IN ('warmup', 'normal', 'drop', 'failure', 'amrap')),
    weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
    reps INTEGER CHECK (reps IS NULL OR reps >= 0),
    duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
    rpe REAL CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
    rir REAL CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10)),
    side TEXT CHECK (side IN ('left', 'right') OR side IS NULL),
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE INDEX idx_workout_sets_workout_exercise ON workout_sets(workout_exercise_id)`,

  // --- import ledger + derived dirty queue --------------------------------
  `CREATE TABLE imports (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    metadata TEXT,
    UNIQUE (source, fingerprint)
  )`,

  `CREATE TABLE derived_dirty (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (entity_type, entity_id, reason)
  )`,

  `CREATE INDEX idx_derived_dirty_profile ON derived_dirty(profile_id, entity_type)`,

  // --- catalog seed bookkeeping -------------------------------------------
  `CREATE TABLE catalog_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`,
];

/** Phase 4: rest timer persistence + routine target snapshot on workouts. */
const V2_STATEMENTS: readonly string[] = [
  // One rest timer per profile (upsert semantics). Timestamps are the
  // authoritative state; the visible countdown is always derived from
  // ends_at - now, so backgrounding and process restarts are free.
  `CREATE TABLE rest_timer (
    profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    workout_exercise_id TEXT REFERENCES workout_exercises(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    updated_at TEXT NOT NULL
  )`,
  // Routine target-set snapshot, written once when a workout starts from a
  // routine; later routine edits never mutate started/finished workouts.
  `ALTER TABLE workout_exercises ADD COLUMN targets_json TEXT`,
];

/** Phase 5: derived-state projections (rebuildable caches over canonical data). */
const V3_STATEMENTS: readonly string[] = [
  // Hevy template-id bridge on aliases (Phase 2 catalog data carried
  // sourceId on alias rows; the v1/v2 schema had no column for it - Phase 5
  // ranking inputs need it to build the engine catalog deterministically).
  `ALTER TABLE exercise_aliases ADD COLUMN source_id TEXT`,

  // Current best personal record per (profile, exercise, type, qualifier).
  // qualifier_key: "" for non-weight-keyed types; "w=<kg>" (canonical kg
  // rounded to 4 decimals) for max_reps_at_weight - NOT NULL so the UNIQUE
  // constraint can never be bypassed by NULL-distinct semantics.
  // Provenance columns are plain TEXT (no FK): derived rows are fully owned
  // by the rebuild; canonical history stays untouched by projections.
  `CREATE TABLE personal_records (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL CHECK (record_type IN
      ('max_weight', 'max_e1rm', 'max_set_volume', 'max_reps_at_weight')),
    qualifier_key TEXT NOT NULL DEFAULT '',
    value REAL NOT NULL CHECK (value >= 0),
    source_reps INTEGER,
    source_set_id TEXT NOT NULL,
    source_workout_id TEXT NOT NULL,
    achieved_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (profile_id, exercise_id, record_type, qualifier_key)
  )`,

  `CREATE INDEX idx_personal_records_exercise
    ON personal_records(profile_id, exercise_id, record_type)`,

  // Immutable PR transition/unlock events. One event per (record, source set):
  // a set can be the first achiever of exactly one new best per record key,
  // so retries/rebuilds can never duplicate history.
  `CREATE TABLE personal_record_events (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL CHECK (record_type IN
      ('max_weight', 'max_e1rm', 'max_set_volume', 'max_reps_at_weight')),
    qualifier_key TEXT NOT NULL DEFAULT '',
    previous_value REAL,
    value REAL NOT NULL CHECK (value >= 0),
    source_set_id TEXT NOT NULL,
    source_workout_id TEXT NOT NULL,
    achieved_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, exercise_id, record_type, qualifier_key, source_set_id)
  )`,

  `CREATE INDEX idx_personal_record_events_exercise
    ON personal_record_events(profile_id, exercise_id, achieved_at)`,
  `CREATE INDEX idx_personal_record_events_workout
    ON personal_record_events(source_workout_id)`,

  // Rank snapshots: one row per (profile, scope, producing workout). Insert
  // order is chronological (the worker appends as state evolves); "latest"
  // reads use MAX(rowid) per scope. Division/progress are NULL at Mythic.
  `CREATE TABLE rank_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('exercise', 'muscle')),
    scope_key TEXT NOT NULL,
    tier_index INTEGER NOT NULL CHECK (tier_index BETWEEN 0 AND 8),
    tier_name TEXT NOT NULL,
    division TEXT CHECK (division IN ('IV', 'III', 'II', 'I') OR division IS NULL),
    score REAL NOT NULL CHECK (score >= 0),
    progress REAL,
    ranking_version TEXT NOT NULL,
    projection_version TEXT NOT NULL,
    calculated_at TEXT NOT NULL,
    source_workout_id TEXT NOT NULL,
    details_json TEXT NOT NULL,
    UNIQUE (profile_id, scope_type, scope_key, source_workout_id)
  )`,

  `CREATE INDEX idx_rank_snapshots_scope
    ON rank_snapshots(profile_id, scope_type, scope_key, calculated_at)`,

  // Immutable-in-intent rank transition events (up AND down; one per
  // (profile, scope, producing workout), replaced wholesale on re-derivation
  // with changed inputs - never duplicated).
  `CREATE TABLE rank_events (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('exercise', 'muscle')),
    scope_key TEXT NOT NULL,
    from_tier_index INTEGER CHECK (from_tier_index IS NULL OR from_tier_index BETWEEN 0 AND 8),
    from_tier TEXT,
    from_division TEXT,
    to_tier_index INTEGER NOT NULL CHECK (to_tier_index BETWEEN 0 AND 8),
    to_tier TEXT NOT NULL,
    to_division TEXT,
    direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
    score REAL NOT NULL CHECK (score >= 0),
    ranking_version TEXT NOT NULL,
    projection_version TEXT NOT NULL,
    source_workout_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, scope_type, scope_key, source_workout_id)
  )`,

  `CREATE INDEX idx_rank_events_scope
    ON rank_events(profile_id, scope_type, scope_key, created_at)`,
  `CREATE INDEX idx_rank_events_workout ON rank_events(source_workout_id)`,

  // Performance: completed workouts by profile + chronology (ranking walks).
  `CREATE INDEX idx_workouts_profile_status_started
    ON workouts(profile_id, status, started_at)`,
];

/** Ordered, immutable migration list. */
export 
const V4_STATEMENTS: readonly string[] = [
  // One active weekly schedule per profile (spec D). revision bumps on every
  // meaningful configuration change; day_boundary_minutes is stored with the
  // v1 default of 240 (04:00) - the shared logical-day helper remains the
  // single boundary implementation.
  `CREATE TABLE training_schedules (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    day_boundary_minutes INTEGER NOT NULL DEFAULT 240
      CHECK (day_boundary_minutes BETWEEN 0 AND 1440),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
  )`,

  // Exactly one row per weekday per schedule (spec E). ISO weekdays:
  // 1 = Monday ... 7 = Sunday. routine association is optional context only.
  `CREATE TABLE training_schedule_days (
    id TEXT PRIMARY KEY NOT NULL,
    schedule_id TEXT NOT NULL REFERENCES training_schedules(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (schedule_id, weekday)
  )`,

  // Materialized obligation ledger (spec G) - the historical truth for
  // streaks. workout_id is plain TEXT on purpose: deleting a canonical
  // workout must not rewrite attendance history (rebuild/reconciliation own
  // this table instead). streak_after is a projection read model.
  `CREATE TABLE scheduled_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    original_date TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    routine_id TEXT,
    status TEXT NOT NULL CHECK (status IN
      ('pending', 'completed', 'missed', 'paused', 'rescheduled', 'cancelled')),
    schedule_revision INTEGER NOT NULL CHECK (schedule_revision >= 1),
    workout_id TEXT,
    completed_at TEXT,
    rescheduled_from_date TEXT,
    streak_after INTEGER CHECK (streak_after IS NULL OR streak_after >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // A date holds at most one ACTIVE obligation. cancelled/rescheduled rows
  // are inert history and may coexist with a new active row (re-enable,
  // reschedule source). Enforces: one obligation per training day; idempotent
  // generation (INSERT OR IGNORE); reschedule conflict rejection (spec V).
  `CREATE UNIQUE INDEX idx_scheduled_sessions_active_date
    ON scheduled_sessions(profile_id, scheduled_date)
    WHERE status IN ('pending', 'completed', 'missed', 'paused')`,

  `CREATE INDEX idx_scheduled_sessions_profile_date
    ON scheduled_sessions(profile_id, scheduled_date)`,
  `CREATE INDEX idx_scheduled_sessions_workout
    ON scheduled_sessions(workout_id) WHERE workout_id IS NOT NULL`,

  // Planned pauses / vacation (spec W). reason is informational. The
  // (profile, start, end, type) key makes duplicate adds idempotent;
  // overlaps are rejected at the service layer (deterministic policy).
  `CREATE TABLE schedule_exceptions (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('pause')),
    reason TEXT,
    created_at TEXT NOT NULL,
    CHECK (end_date >= start_date),
    UNIQUE (profile_id, start_date, end_date, type)
  )`,

  `CREATE INDEX idx_schedule_exceptions_profile
    ON schedule_exceptions(profile_id, start_date)`,

  // Streak cache (spec Q): a rebuildable projection over the ledger + pauses.
  `CREATE TABLE streak_cache (
    profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
    best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
    perfect_weeks INTEGER NOT NULL DEFAULT 0 CHECK (perfect_weeks >= 0),
    last_completed_session_id TEXT,
    recalculated_at TEXT
  )`,

  // Streak events (spec AC): milestones/broken/new_best with STABLE identity
  // - UNIQUE(profile, type, key) makes re-derivation and rebuilds idempotent
  // (a milestone is celebrated exactly once).
  `CREATE TABLE streak_events (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('milestone', 'broken', 'new_best')),
    key TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, type, key)
  )`,

  `CREATE INDEX idx_streak_events_profile
    ON streak_events(profile_id, occurred_at)`,

  // Dedicated streak/schedule repair queue (spec S, option B): explicitly
  // typed and separate from the strength dirty queue so neither consumer can
  // misinterpret the other's markers. UNIQUE key gives per-entity coalescing.
  `CREATE TABLE streak_dirty (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('workout', 'schedule', 'exception')),
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN
      ('workout_completed', 'schedule_changed', 'schedule_enabled_changed',
       'exception_changed', 'session_rescheduled')),
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, entity_type, entity_id, reason)
  )`,
];

// ---------------------------------------------------------------------------
// Schema v5 (Phase 7): notifications + Phase 6 temporal-validity hardening.
// - scheduled_sessions.pending_until: the instant a session stopped being
//   pending through a SYSTEM-driven transition (missed/paused/cancelled).
//   Deterministic attendance semantics: a completed workout satisfies an
//   inactive session iff pending_until >= workout.finished_at - attendance
//   outcomes no longer depend on asynchronous processing order.
// - training_schedule_days.reminder_minutes_after_midnight: per-day local
//   reminder time. NOTIFICATION configuration - deliberately outside the
//   attendance revision semantics (spec E).
// - notification_preferences / notification_jobs: local scheduling intent.
//   Stable dedupe identity via partial UNIQUE index over scheduled rows.
// ---------------------------------------------------------------------------
const V5_STATEMENTS: string[] = [
  `ALTER TABLE scheduled_sessions ADD COLUMN pending_until TEXT`,

  `ALTER TABLE training_schedule_days ADD COLUMN reminder_minutes_after_midnight INTEGER`,

  `CREATE TABLE notification_preferences (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    training_reminders_enabled INTEGER NOT NULL DEFAULT 0 CHECK (training_reminders_enabled IN (0,1)),
    secondary_reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (secondary_reminder_enabled IN (0,1)),
    secondary_delay_minutes INTEGER NOT NULL DEFAULT 150 CHECK (secondary_delay_minutes BETWEEN 5 AND 720),
    reminder_style TEXT NOT NULL DEFAULT 'normal' CHECK (reminder_style IN ('gentle','normal','competitive')),
    rest_timer_notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (rest_timer_notifications_enabled IN (0,1)),
    permission_status TEXT NOT NULL DEFAULT 'undetermined' CHECK (permission_status IN ('undetermined','granted','denied')),
    permission_prompt_seen INTEGER NOT NULL DEFAULT 0 CHECK (permission_prompt_seen IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE notification_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('training_primary','training_secondary','rest_timer')),
    scheduled_session_id TEXT,
    dedupe_key TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    platform_notification_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('scheduled','cancelled','expired')),
    payload_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT
  )`,

  // Idempotency (spec H): at most one SCHEDULED job per (profile, dedupe key).
  `CREATE UNIQUE INDEX idx_notification_jobs_active
    ON notification_jobs(profile_id, dedupe_key) WHERE state = 'scheduled'`,

  `CREATE INDEX idx_notification_jobs_profile
    ON notification_jobs(profile_id, state, scheduled_for)`,
];

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "schema_v1_core", statements: V1_STATEMENTS },
  { version: 2, name: "schema_v2_workout_session", statements: V2_STATEMENTS },
  { version: 3, name: "schema_v3_derived_state", statements: V3_STATEMENTS },
  { version: 4, name: "schema_v4_scheduled_streaks", statements: V4_STATEMENTS },
  { version: 5, name: "schema_v5_notifications", statements: V5_STATEMENTS },
];

/** Current PRAGMA user_version (0 on a fresh database). */
export function schemaVersion(driver: DatabaseDriver): number {
  const row = driver.get("PRAGMA user_version");
  const v = row?.user_version;
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Apply all pending migrations. Foreign keys stay ON for the whole session
 * (the pragma is a no-op inside transactions, so it is set at open time by
 * openDatabase/openNodeDatabase - and defensively here before migrating).
 */
export function migrate(driver: DatabaseDriver): number {
  driver.exec("PRAGMA foreign_keys = ON");
  let current = schemaVersion(driver);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    driver.transaction(() => {
      for (const statement of migration.statements) driver.exec(statement);
      driver.exec("PRAGMA user_version = " + String(migration.version));
    });
    current = migration.version;
  }
  return current;
}