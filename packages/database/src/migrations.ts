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

export const SCHEMA_VERSION = 2;

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

/** Ordered, immutable migration list. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "schema_v1_core", statements: V1_STATEMENTS },
  { version: 2, name: "schema_v2_workout_session", statements: V2_STATEMENTS },
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