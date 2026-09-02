# Database design (Phases 3-6)

This document records the persistence decisions: the ORM/library
evaluation, the schema layout (v1 baseline, v2 workout-session additions, v3
derived-state projections), the source-of-truth rules, IDs, units, migration
and seeding policies, transactions, indexes and integrity tests. Phase
additions are marked "Phase 4" / "Phase 5" throughout.

## 1. Library decision: expo-sqlite + hand-rolled migrations (no Drizzle)

The implementation spec permits an ORM ("e.g. Drizzle") but does not require
one. We evaluated Drizzle ORM against plain `expo-sqlite` with a thin,
hand-rolled data layer:

| Criterion | Drizzle ORM | Chosen: expo-sqlite + typed repositories |
| --- | --- | --- |
| Migrations | `drizzle-kit generate` produces SQL files that must be bundled as a Metro asset and applied by `drizzle-orm/expo-sqlite/migrator`; adds a build step and couples runtime migration to asset resolution under Metro + pnpm hoisting (both are fragile points we already manage) | ~80-line version-tracked migrator over `PRAGMA user_version`; each migration is a plain TS module; runs identically in the app and in vitest |
| Type safety | Compile-time SQL types (tables/columns inferred from schema objects) | Type safety sits at the repository boundary instead: repositories return domain objects (`@openrank/domain`) and are the only SQL consumers; row mapping is explicit and tested |
| Transactions | Supported | `DatabaseDriver.transaction()` = `BEGIN IMMEDIATE ... COMMIT` with rollback on throw; identical semantics in both drivers |
| Indexes / DDL control | Full, but expressed through a schema DSL | Full, expressed as explicit SQL in migrations (reviewable, byte-exact) |
| Expo compatibility | Works with expo-sqlite via adapter, but adds a dependency on the drizzle-expo dialect | `expo-sqlite` is first-party (same team as the runtime); the app driver is a ~60-line wrapper |
| Testing | Drizzle test story would still need a second driver | We ship a `node:sqlite` (`DatabaseSync`) driver, so the entire repository layer runs in vitest with zero native builds and zero mocks |

**Decision:** plain SQL over `expo-sqlite` with hand-rolled, version-tracked
migrations and typed repositories. The deciding factors were (a) the migrator
asset path under Metro/pnpm hoisting, (b) first-party Expo support, and (c)
testability through `node:sqlite` without any native toolchain. The repository
layer provides the type safety Drizzle would have provided at the query layer.

**Driver interface (hexagonal):** `packages/database/src/driver.ts` defines
`DatabaseDriver` (`exec/run/get/all/transaction/close`). Two implementations:

- `ExpoSqliteDriver` (`@openrank/database/expo`) - wraps `expo-sqlite`
  `openDatabaseSync` for the app.
- `NodeSqliteDriver` (`@openrank/database/node`) - wraps `node:sqlite`
  `DatabaseSync` for tests/CI/tools.

Both drivers set `PRAGMA foreign_keys = ON` on every connection. WAL
(`PRAGMA journal_mode = WAL`) is enabled by `openDatabase` for file-backed
databases (in-memory test databases keep their own journal mode).

## 2. Source-of-truth rules

- **SQLite is the canonical persistence for everything mutable**: profile,
  bodyweight entries, routines, workouts, imports, the derived-state dirty
  queue and the seeded exercise catalog.
- **React state is never canonical.** Screens may cache repository data in
  component state, but the database is the only authority; anything not
  written through a repository is lost and must not be relied upon.
- **The catalog JSON is a build artifact, not a runtime source of truth.** It
  seeds the database at first launch; after that, exercise reads go through
  the exercise repository (the Exercises screen reads SQLite).
- **The ranking engine remains the sole authority for rank classification.**
  The database stores per-exercise *eligibility metadata* copied from the
  catalog seed (see section 8); it never computes ranks.

## 3. Schema

`SCHEMA_VERSION = 2` (Phase 4), stored in `PRAGMA user_version`. Migration
v1 creates the baseline; migration v2 (Phase 4) adds the rest-timer table and
the workout target snapshot column.

### 3.1 Version 1 (baseline)

Migration v1 creates:

**Tables (17):** `profiles`, `bodyweight_entries`, `muscles`, `exercises`,
`exercise_muscles`, `exercise_aliases`, `exercise_instructions`,
`exercise_media`, `routines`, `routine_exercises`, `routine_set_targets`,
`workouts`, `workout_exercises`, `workout_sets`, `imports`,
`derived_dirty`, `catalog_meta`.

**Foreign keys (16 edges):**

- `bodyweight_entries.profile_id -> profiles` CASCADE
- `exercise_muscles.exercise_id -> exercises` CASCADE;
  `exercise_muscles.muscle_id -> muscles` RESTRICT
- `exercise_aliases.exercise_id -> exercises` CASCADE
- `exercise_instructions.exercise_id -> exercises` CASCADE
- `exercise_media.exercise_id -> exercises` CASCADE
- `routines.profile_id -> profiles` CASCADE
- `routine_exercises.routine_id -> routines` CASCADE;
  `routine_exercises.exercise_id -> exercises` RESTRICT
- `routine_set_targets.routine_exercise_id -> routine_exercises` CASCADE
- `workouts.profile_id -> profiles` CASCADE;
  `workouts.routine_id -> routines` SET NULL
- `workout_exercises.workout_id -> workouts` CASCADE;
  `workout_exercises.exercise_id -> exercises` RESTRICT
- `workout_sets.workout_exercise_id -> workout_exercises` CASCADE
- `derived_dirty.profile_id -> profiles` CASCADE

Rationale: deleting a workout/routine/bodyweight row destroys only rows that
have no meaning without it (cascades). Deleting an *exercise* that appears in
any routine or workout history is **restricted** - training history must
never be silently rewritten; custom exercises can only be removed once no
history references them. Deleting a routine keeps the workout that was
started from it (`SET NULL`); deleting a muscle is restricted while any
exercise references it (the seed upserts muscles, never deletes them).

**Indexes (12):**

- `idx_exercises_ranking (ranking_eligibility)` - rank-supported filter
- `idx_exercise_muscles_muscle (muscle_id)` - by-muscle lookups
- `idx_exercise_aliases_exercise (exercise_id)` - alias/detail joins
- `idx_exercise_media_exercise (exercise_id)`
- `idx_routines_profile (profile_id)`
- `idx_routine_exercises_routine (routine_id, position)` - ordered read
- `idx_workouts_profile_status (profile_id, status)` - "active workout" query
- `idx_workouts_single_active (profile_id) WHERE status='active'` - **partial
  unique index enforcing at most one active workout per profile**
- `idx_workouts_started_at (started_at)` - history ordering
- `idx_workout_exercises_workout (workout_id, position)` - ordered read
- `idx_workout_sets_workout_exercise (workout_exercise_id)` - set reads
- `idx_derived_dirty_profile (profile_id, entity_type)` - dirty drain scans

Column-level uniqueness: `exercises.slug`,
`exercise_aliases.normalized_alias` (a display alias resolves to exactly one
owner), `bodyweight_entries (profile_id, measured_at)`,
`routine_exercises (routine_id, position)`, `routine_set_targets
(routine_exercise_id, position)`, `workout_sets (workout_exercise_id,
position)`, `derived_dirty (entity_type, entity_id, reason)` (idempotent
dirty marks), `imports (source, external_id)`.

CHECK constraints guard the domain invariants at the storage layer:
`workout_sets.weight_kg >= 0`, `rpe BETWEEN 1 AND 10`, `rir BETWEEN 0 AND 10`,
`bodyweight_entries.weight_kg > 0`, `workouts.status != 'completed' OR
finished_at IS NOT NULL`, and set-type/route/status enum checks.

### 3.2 Version 2 (Phase 4: workout session)

Migration v2 adds two changes, each transactional with the `user_version`
bump:

- **`rest_timer`** - one row per profile (primary key `profile_id` -> profiles
  CASCADE) holding the authoritative rest-timer state:
  `workout_id -> workouts` CASCADE, `workout_exercise_id -> workout_exercises`
  SET NULL, `started_at`, `ends_at` (both ISO-8601 UTC), `duration_seconds`
  (> 0) and `updated_at`. The **absolute `ends_at` timestamp is the source of
  truth** - remaining time is always derived on read, so backgrounding and
  process death cost nothing. Upserts use
  `ON CONFLICT(profile_id) DO UPDATE` (one live timer per profile).
- **`workout_exercises.targets_json`** (nullable TEXT) - the routine
  target-set snapshot copied at workout start (type, rep range, weight, RPE,
  RIR per planned set). Stored as JSON on the workout block (not rows) so a
  session owns its structure without pre-created empty sets; later routine
  edits never touch it (see docs/WORKOUT_SPEC.md section "Snapshot").

## 4. IDs

- **Locally owned mutable entities** (profiles, bodyweight entries, custom
  exercises, aliases/media the user creates, routines, workouts, workout
  exercises/sets, imports, dirty records) use **UUIDv7 (RFC 9562)**,
  implemented in `@openrank/shared` (`uuidv7`): 48-bit millisecond timestamp +
  74 random bits - unique and roughly time-ordered (good index locality,
  offline-friendly for a future sync phase). Randomness is injected:
  `node:crypto` in tests/tools, `expo-crypto` in the app.
- **Dataset-derived rows keep their canonical stable ids**: exercises
  (`fdb:<free-exercise-db id>`), muscles (`m:<engine key>`), seed aliases
  (`al_<fnv1a-64 hex of normalized alias>`), seed media
  (`md_<fnv1a-64 hex of image path>`). These ids are deterministic functions
  of the dataset, so reseeding produces identical ids.
- Custom (user-created) exercises get a UUIDv7 id plus `is_custom = 1`,
  `source = 'user'` and a slug de-duplicated with a `-2` suffix when needed.

## 5. Units, timestamps and locales

- **Internal units are always canonical SI**: mass in kilograms (`REAL`),
  time in seconds/ISO-8601 UTC. Display conversion (lb) happens only in the
  UI layer.
- **Timestamps**: all stored as ISO-8601 UTC strings
  (`YYYY-MM-DDTHH:MM:SS.sssZ`, `nowUtc()`). Workout start additionally stores
  `start_local_date` (the athlete's local calendar date) and
  `start_timezone_offset_minutes` so training-day grouping is stable across
  DST and travel. `workouts.logical_training_date` equals
  `start_local_date` in Phase 3 (a later phase may introduce a divergence
  rule, e.g. pre-midnight sessions).
- **Bodyweight entries** are unique per `(profile_id, measured_at)`; the
  profile resolution rule used by derived computations is: latest entry at or
  before the reference time, else the earliest entry, else `null` (never a
  default weight).

## 6. Migration policy

- Every schema change lands as a new migration in `MIGRATIONS` (array ordered
  by integer `version`, contiguous, starting at 1).
- `migrate(driver)` reads `PRAGMA user_version` and applies pending
  migrations, **each in its own transaction** (`BEGIN IMMEDIATE` ... set
  `user_version` inside the transaction ... `COMMIT`), so a crash
  mid-migration leaves the previous version intact with no partial DDL
  (verified by test).
- Migrations are append-only: shipped migrations are never edited.

## 7. Seed policy (deterministic, idempotent, user-data preserving)

`seedCatalog(driver, catalog)` runs on every launch after migration:

- `muscles` are **upserted, never deleted** (custom exercises may reference
  them; deletion would violate the RESTRICT FK).
- Dataset `exercises` rows are upserted **by canonical id with a content
  comparison** - unchanged exercises are skipped (`stats.unchanged`), changed
  ones are updated in place. `INSERT OR REPLACE` is never used (it deletes +
  reinserts, breaking FK references).
- Dataset child rows (junctions, aliases, instructions, media) are deleted
  **scoped to `is_custom = 0`** and re-inserted from the catalog; user-created
  aliases and custom exercises are never touched.
- Ids for dataset rows are deterministic (section 4), so reseeding is a no-op
  byte-for-byte unless the catalog changed.
- `catalog_meta` records: `fingerprint` (stable hash over schema version,
  source commit and the per-exercise id|ranking-support list),
  `catalog_schema_version`, `ranking_compatibility`, `dataset_commit`,
  `seeded_at`. The fingerprint changes iff the catalog content relevant to
  ranking/search changed - a later phase can use it to decide when derived
  state must be recomputed.

Phase 2 seed: 876 exercises, 17 muscles, 1079 aliases, plus instructions and
media from the free-exercise-db snapshot; eligible 440 / provisional 48 /
unsupported 388 ranking-support rows (488 participating exercises).

## 8. Ranking eligibility semantics (stored columns)

`exercises` carries `ranking_eligibility` (`eligible` | `provisional` |
`unsupported`), `ranking_group` (engine major group or NULL),
`ranking_strategy` (`template` | `keyword` | `curated` | `none` - how the
support was established) and `ranking_reason` (why support is missing or
provisional; NULL for eligible). "Participates in ranking" = eligibility !=
`unsupported`. These are seed-copied metadata, not computed state; the frozen
engine remains the only rank classifier.

## 9. Transaction policy (crash safety)

- Every repository mutation runs inside one transaction on the driver;
  canonical row writes and their `derived_dirty` markers commit
  **atomically** (a set write can never exist without its dirty marker).
- Dirty marks are idempotent (`INSERT OR IGNORE` on
  `(entity_type, entity_id, reason)`); reasons: `sets_changed`,
  `workout_saved`, `workout_completed`, `workout_discarded`,
  `bodyweight_changed`, `profile_changed`.
- WAL journal mode + per-write transactions mean a process kill mid-workout
  loses at most the write in flight, never a committed set. The acceptance
  test (`crash-reopen.test.ts`) closes the database mid-workout, reopens it,
  and asserts the active workout, every completed set and the dirty queue
  survive.
- Reordering child rows (routine/workout exercises, sets) uses a two-phase
  update (shift positions negative, then assign dense final positions) so the
  position uniqueness constraints can never be violated mid-transaction.
- **Driver transactions are reentrant (Phase 4)**: calling `transaction()`
  while already inside one joins the outer transaction instead of issuing a
  nested `BEGIN`. This lets services compose several repository calls into a
  single atomic `BEGIN IMMEDIATE` (e.g. complete-set = set update + dirty
  markers + rest-timer start) without the repository layer knowing about
  services.

## 10. Integrity + service test list

`packages/database/src` (all running against real SQLite):

- `migrations.test.ts` - latest schema applied to an empty database
  (including `rest_timer`); migrate is idempotent; versions contiguous; a
  failed migration rolls back with no partial DDL; `foreign_keys = ON` on
  every connection; WAL on file DBs.
- `seed.test.ts` - full seed counts; reseed is a no-op (`unchanged`);
  deterministic ids/fingerprint; user custom exercise + user alias survive
  reseeds; a changed catalog updates rows in place; `catalog_meta` recorded.
- `integrity.test.ts` - FK enforcement (no orphans); workout -> exercises ->
  sets cascade; profile deletion cascades to bodyweight/routines/workouts;
  exercise deletion RESTRICTed while referenced; unique constraints (slug,
  alias, single active workout, dirty queue, imports); CHECK constraints
  (negative weights, invalid set types, completed-without-finished_at,
  non-positive bodyweight); custom exercises excluded from seed scope.
- `exercise-repo.test.ts` - find by id/slug; ranking metadata from seed;
  search ranking (exact alias first); filters
  (group/tracking/equipment/rank); 488 participating exercises; alias
  resolution (name/variant/curated); muscles/instructions/media; detail
  aggregate; custom exercise creation.
- `profile-bodyweight.test.ts` - default profile idempotent; onboarding
  updates; unknown-id rejection; history ordering; resolution rule; dirty
  markers; positive-weight validation.
- `routine-repo.test.ts` - lifecycle (rename/archive/notes); ordered
  exercises with dense positions; foreign-id rejection; target replacement;
  delete cascade.
- `workout-repo.test.ts` - active workout fields; single-active enforcement
  and resume; set add/update/complete/delete with renumbering; exercise
  reorder; complete/discard + history; dirty markers on every write.
- `crash-reopen.test.ts` - hard close mid-workout; reopen; active workout and
  all sets intact; dirty queue intact; workout continues.
- `services/logical-date.test.ts` (Phase 4) - the centralized 04:00 logical
  training-day helper: same-day boundaries, early-morning rollover to the
  previous local day, offset handling.
- `services/set-validation.test.ts` (Phase 4) - edit-time vs completion-time
  validation per tracking type: negatives/NaN/Infinity rejected, decimals
  allowed, RPE 1-10 / RIR 0-10 ranges, completion requires the fields the
  tracking type demands.
- `services/workout-service.test.ts` (Phase 4) - start empty/from routine,
  conflict error, snapshot semantics (later routine edits never mutate a
  started workout), finish policies (remove vs reject incomplete sets),
  summary math, discard cascade + dirty cleanup, recent exercises, previous
  performance.
- `services/routine-service.test.ts` (Phase 4) - routine CRUD/archive lists,
  validation, per-tracking-type set operations, dirty markers for
  completed/changed/deleted completed sets.
- `services/rest-timer-service.test.ts` (Phase 4) - persisted timer
  survives a full database close/reopen; remaining time derived from
  `ends_at`; expired state after restart.
- `services/process-death.test.ts` (Phase 4) - the full acceptance
  scenario (task U): structure, sets, set types, notes, duration derivation,
  dirty queue AND rest-timer recovery after a simulated process death with
  a clock jump past the timer's end.

## 11. Exports

`@openrank/database` root exports the driver-agnostic API only
(`openDatabase`, result types, repositories, migrations, seed) so vitest
never pulls React Native. Platform drivers are subpath exports:
`@openrank/database/expo` (app), `@openrank/database/node` (tests/tools).
`openDatabase(driver, { catalog?, newId? })` performs: PRAGMAs -> migrate ->
seed -> construct repositories, returning them plus `schemaVersion`,
`catalogFingerprint` and `seedUnchanged`.

## Phase 5 additions (schema v3): derived-state projections

Migration `schema_v3_derived_state` adds the rebuildable caches described in
docs/DERIVED_STATE.md:

- `personal_records` - current best per
  UNIQUE(profile_id, exercise_id, record_type, qualifier_key).
  `qualifier_key` is NOT NULL DEFAULT '' (an empty-string sentinel, because
  SQLite UNIQUE treats NULLs as distinct and would bypass the key).
- `personal_record_events` - unlock history, one row per record-setting set
  (UNIQUE includes source_set_id), `previous_value` NULL = first record.
- `rank_snapshots` - rank state per (profile, scope, producing workout);
  insert order is chronological, "latest" reads use MAX(rowid) per scope.
  Division/progress are NULL at Mythic.
- `rank_events` - tier transitions (up AND down), one per
  (profile, scope, producing workout); re-derivation with changed inputs
  replaces the row instead of duplicating it.
- `exercise_aliases.source_id` (nullable TEXT) - the Hevy template id from
  the Phase 2 alias build; seeded from the bundled catalog and required by
  the RankingInputBuilder to synthesize the engine catalog.
- `idx_workouts_profile_status_started` - ranking walks read completed
  workouts chronologically per profile.

Provenance columns are intentionally plain TEXT (no FK): derived rows are
owned by the rebuild, so canonical deletions must not cascade into
half-updated projections. Integrity tests keep asserting FK wiring for
canonical tables only.

Seed policy is unchanged (idempotent, transactional, preserves user data);
alias rows now also carry `source_id`, refreshed on every seed run.

## Phase 6 additions (schema v4): scheduled training streaks

Migration `schema_v4_scheduled_streaks` adds the attendance ledger and its
projections (full contract: docs/STREAK_SPEC.md):

- `training_schedules` - one per profile (UNIQUE profile_id), `revision`
  bumps on meaningful weekly changes, `day_boundary_minutes` stores the v1
  default 240 (04:00 logical boundary, single shared implementation).
- `training_schedule_days` - ISO weekday (1=Mon..7=Sun) with
  UNIQUE(schedule_id, weekday); routine_id is FK ON DELETE SET NULL
  (association is context, never an attendance requirement).
- `scheduled_sessions` - the obligation ledger. Statuses pending /
  completed / missed / paused / rescheduled / cancelled. Partial UNIQUE
  index over active statuses enforces one obligation per (profile, date),
  makes generation idempotent (INSERT OR IGNORE) and reschedule conflicts
  explicit; cancelled/rescheduled rows may coexist with a new active row.
  `workout_id` is plain TEXT on purpose (canonical deletion must not
  rewrite attendance history); `streak_after` is a projection read model.
- `schedule_exceptions` - planned pauses; UNIQUE(profile, start, end, type)
  makes duplicate adds idempotent, overlaps are rejected at service level.
- `streak_cache` / `streak_events` - rebuildable projections; events carry
  stable identity UNIQUE(profile, type, key) so milestones never
  re-celebrate.
- `streak_dirty` - dedicated repair queue (spec S option B), UNIQUE per
  (profile, entity, reason) for coalescing.
## Phase 7 additions (schema v5): local notifications

Migration `schema_v5_notifications` adds the notification job store and its
configuration (full contract: docs/NOTIFICATIONS_SPEC.md):

- `scheduled_sessions.pending_until` (nullable TEXT) - Phase 7 hardening
  (spec AB): records the instant a session STOPPED being the pending
  obligation via a SYSTEM transition (missed / paused / cancelled), set
  first-write-wins via COALESCE; cleared whenever status returns to
  `pending`. User-declared transitions (reschedules) leave it null. The
  completed-workout matcher may fall back to a session that was invalidated
  only AFTER the workout finished (`pending_until >= finishedAt`), which
  makes matching deterministic regardless of processing order - the
  disable/finish race can no longer turn a real session into a bonus.
- `training_schedule_days.reminder_minutes_after_midnight` (nullable
  INTEGER) - per-training-day reminder wall time in minutes after local
  midnight; null = no reminder for that day.
- `notification_preferences` (UNIQUE profile_id) - opt-in flags:
  training_reminders_enabled / secondary_reminder_enabled (both default 0),
  secondary_delay_minutes (CHECK 5..720, default 150), reminder_style
  ('gentle' | 'normal' | 'competitive', default 'normal'),
  rest_timer_notifications_enabled (default 0), permission_status
  ('undetermined' | 'granted' | 'denied') and permission_prompt_seen.
- `notification_jobs` - the reconciler's durable ledger, one row per
  desired OS notification: kind CHECK ('training_primary',
  'training_secondary', 'rest_timer'), state CHECK ('scheduled',
  'cancelled', 'expired'), dedupe_key, payload_hash (FNV-1a over the exact
  OS copy + payload), platform_notification_id, cancelled_at. Partial
  UNIQUE `idx_notification_jobs_active(profile_id, dedupe_key) WHERE
  state='scheduled'` makes reconcile inserts idempotent (INSERT OR IGNORE).

Notification rows are projections: they are rebuildable from
`scheduled_sessions` + `training_schedule_days` + `rest_timer` at any
time, so deleting canonical rows must never be blocked by them. A fresh
reconcile on an empty job table repairs the OS scheduler from scratch
(drift repair, spec AC).

## Phase 7.1 additions (schema v6): onboarding state

Migration `schema_v6_onboarding_state`:

- `profiles.onboarding_step` (nullable TEXT) - durable first-launch step
  pointer; the resume route derives from it, never from React state. NULL
  before the flow starts and after completion.
- Compatibility migration: `UPDATE profiles SET onboarding_completed = 1
  WHERE onboarding_completed = 0` - every profile from a v1-v5 database
  predates the onboarding flow and stays fully usable without seeing
  first-launch UI. Fresh installs have no profile row and onboard.

Vendored-data integrity is now pinned byte-exact: .gitattributes marks
`datasets/upstream/**`, the legacy engine files and the catalog data
files `-text`, so raw working-tree bytes equal the committed blobs on
every platform and the license/integrity hashes are machine-independent.
