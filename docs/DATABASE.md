# Database design (Phase 3)

This document records the Phase 3 persistence decisions: the ORM/library
evaluation, the schema v1 layout, the source-of-truth rules, IDs, units,
migration and seeding policies, transactions, indexes and integrity tests.

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

## 3. Schema version 1

`SCHEMA_VERSION = 1`, stored in `PRAGMA user_version`. Migration v1 creates:

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

## 10. Integrity test list

`packages/database/src` (47 tests, all running against real SQLite):

- `migrations.test.ts` - schema v1 applied to an empty database; migrate is
  idempotent; versions contiguous; a failed migration rolls back with no
  partial DDL; `foreign_keys = ON` on every connection; WAL on file DBs.
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

## 11. Exports

`@openrank/database` root exports the driver-agnostic API only
(`openDatabase`, result types, repositories, migrations, seed) so vitest
never pulls React Native. Platform drivers are subpath exports:
`@openrank/database/expo` (app), `@openrank/database/node` (tests/tools).
`openDatabase(driver, { catalog?, newId? })` performs: PRAGMAs -> migrate ->
seed -> construct repositories, returning them plus `schemaVersion`,
`catalogFingerprint` and `seedUnchanged`.
