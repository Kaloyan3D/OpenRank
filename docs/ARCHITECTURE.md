# Architecture

OpenRank is a local-first mobile strength-training app. The one rule that
overrides everything else:

```text
             USER DATA
                |
                v
             SQLite
      +---------+---------+
      v         v         v
   Workout     Rank     Streak
    Engine    Engine    Engine
      |         |         |
      +---------+---------+
                v
               UI
```

Ranks, streaks, PRs, and analytics are **deterministic projections** over
canonical workout data. Never: `UI -> random state -> formulas -> APIs -> maybe DB`.

## Layer architecture

```text
+------------------------------+
|          Mobile UI           |
| Expo Router / React Native   |
+---------------+--------------+
                v
+------------------------------+
|       Domain Services        |
| WorkoutService RoutineService RankingService PRService      |
| ScheduleService StreakService NotificationService Analytics |
| BackupService ImportService                                 |
+---------------+--------------+
                v
+------------------------------+
|       Repository Layer       |
+---------------+--------------+
                v
+------------------------------+
|          SQLite DB           |
+------------------------------+
```

Ranking additionally flows: `RankingService -> ranking-core -> Versioned
Ranking Standard`. **No UI component may contain ranking formulas.**

## Repository layout

| Path | Purpose | Status |
| --- | --- | --- |
| `apps/mobile` | Expo app. UI only - no core business logic. | Phase 0 scaffold + Phase 2 catalog screens |
| `packages/domain` | Pure domain models (exercise, workout, profile). | Phase 0 (exercise model) |
| `packages/database` | SQLite access, isolated behind repository/domain layers. | Phase 3 |
| `packages/ranking-core` | Ranking engine: legacy copy + strict TS port + goldens. | Phase 1 complete |
| `packages/exercise-catalog` | Deterministic catalog build, taxonomy, aliases, search, ranking bridge. | Phase 2 complete |
| `packages/importers` | Import DTOs + parsers (never write to SQLite directly). | Phase 9 |
| `packages/shared` | Small pure utilities (unit conversion). | Phase 0 |
| `scripts` | Catalog build, fixture generation, coverage exceptions, license check. | Phase 0-2 |
| `datasets` | Pinned upstream datasets + `sources.lock.json`. | Phase 2 complete |

## Technology stack

React Native + Expo + TypeScript (strict) + Expo Router + Expo SQLite +
pnpm workspace. SQLite runs with foreign keys ON, WAL mode, transactions, and
SQL migrations. Drizzle ORM over Expo SQLite is permitted (not required) to
improve migrations and query organization - decision deferred to Phase 3.

**SQLite is the source of truth. React state is not.** React/Zustand state may
only hold temporary UI state.

## Key invariants

1. The app must remain useful with zero backend, zero account, zero internet.
2. Workout autosave: every meaningful action writes to SQLite in a transaction;
   a force-kill mid-workout must not lose any completed set.
3. Derived data (PRs, ranks, streak cache, analytics) is rebuilt from a dirty
   queue: `set completed -> workout_set saved -> derived_dirty insert -> commit`,
   then a DerivedDataWorker recalculates. A crash between save and recalculation
   self-repairs on next launch.
4. Rank snapshots and rank events store the `ranking_version` that produced them.
5. Kilograms are the internal storage unit, always.
6. Rest timer state is an absolute `restEndsAt` timestamp, never a decremented counter.

## Decisions log (Phase 2)

- **Vendored snapshot over build-time download:** the Free Exercise DB is
  vendored byte-identical at the pinned commit (`datasets/upstream/`); builds
  never touch the network and CI verifies reproducibility by regenerating
  `catalog.v1.json` and failing on diff.
- **No timestamps in generated artifacts:** `catalog.v1.json` is
  byte-deterministic (sorted, machine-independent string ordering); provenance
  (commit, checksums, import timestamp) lives only in
  `datasets/sources.lock.json`.
- **Canonical muscle ids mirror the engine:** the 17-muscle taxonomy uses the
  ranking engine's primary keys (FreeDB "middle back" -> `upper_back`), so a
  catalog exercise's primary muscle routes 1:1 onto the engine's groups.
- **Aliases are an import/search contract:** exact + normalized + generated
  variants + Hevy template aliases (with `sourceId`) are resolved
  deterministically; ambiguous keys are dropped, curated overrides are
  validated at build time.
- **Catalog ranking hints are advisory:** `ranking.group` derives from the
  primary muscle (anatomical grouping for UI); the frozen engine remains the
  sole authority for rank classification. Divergences are measured and
  documented in `ranking-coverage-exceptions.json`.
- **Metro transpiles workspace sources:** `transpilePackages` wires
  `@openrank/exercise-catalog` (TS + JSON subpath export) into the app;
  the catalog is a static asset, fully offline.

## Decisions log (Phase 0 / Phase 1)

- **Repository root:** this pnpm monorepo is the standalone OpenRank repository
  (the fitness app does not live inside any other product's repository).
- **Package manager:** pnpm 11 (pinned via `packageManager`), Node >= 20, CI runs Node 22.
- **TypeScript:** strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
  (see `tsconfig.base.json`). TS ~6.0.3 unified repo-wide in Phase 2 (Expo
  SDK 57's expected version; typescript-eslint supports < 6.1).
- **Expo SDK 57** (React Native 0.86.3, React 19.2.3), Expo Router tab
  navigation.
- **Legacy engine vendoring:** only `src/engine.js` + the exercise template
  catalog are vendored under `packages/ranking-core/src/legacy/`, pinned and
  byte-identical (verified by checksum in the legacy README). The upstream web
  UI is not vendored - OpenRank re-implements presentation natively.
- **App/package wiring:** Phase 0 intentionally keeps `apps/mobile` free of
  package imports; wiring (metro transpile of workspace TS sources) lands with
  the first feature phase that needs it, to avoid shipping dead configuration.
- **Overall rank:** the `OverallRankCalculator` interface exists in
  `ranking-core` but `overallRankEnabled = false`; UI shows a "Strength
  Profile" instead of a misleading averaged rank.
- **Project license:** AGPL-3.0-or-later (per spec recommendation, so hosted
  derivatives stay open). Hevy Ranks stays MIT under THIRD_PARTY_NOTICES.md.

## Decisions log (Phase 3 - Local Database)

- **Persistence:** SQLite via `expo-sqlite` is the canonical store for all
  mutable state (profile, bodyweight, routines, workouts, imports, dirty
  queue, seeded catalog). React state is never canonical; the catalog JSON is
  a build artifact that seeds the DB, after which screens read repositories.
- **No ORM:** hand-rolled version-tracked migrations over `PRAGMA
  user_version` + typed repositories; Drizzle was evaluated and declined
  (migrator-asset path under Metro/pnpm hoisting, extra dependency, weaker
  node-driven test story). Full evaluation in `docs/DATABASE.md`.
- **Hexagonal database package:** `@openrank/database` exposes a
  driver-agnostic root (`openDatabase`), with `./expo` (expo-sqlite) and
  `./node` (node:sqlite `DatabaseSync`) subpath drivers - the same
  repositories are exercised in vitest and in the app. Driver subpaths are
  deliberately not re-exported from the root (importing expo-sqlite in vitest
  would pull React Native Flow sources).
- **Schema v1:** 17 tables, 16 FK edges (exercise references from
  routines/workouts are RESTRICT to protect training history; routine
  deletion SET NULLs the workout that started from it; everything else
  cascades), 12 indexes including the partial unique
  `idx_workouts_single_active` enforcing at most one active workout per
  profile.
- **IDs:** UUIDv7 (RFC 9562, `@openrank/shared`) for locally owned mutable
  entities; deterministic canonical ids (`fdb:*`, `m:*`, `al_*`, `md_*`)
  for dataset rows so reseeding is byte-stable.
- **Seeding:** deterministic + idempotent + user-data preserving; muscles
  upserted never deleted, dataset exercises updated in place by content
  compare (never `INSERT OR REPLACE`), child rows replaced scoped to
  `is_custom = 0`, catalog fingerprint recorded in `catalog_meta`.
- **Derived-state queue:** `derived_dirty` markers written in the same
  transaction as the canonical change (idempotent by
  `(entity_type, entity_id, reason)`), persisted across restarts; a later
  phase drains them to rebuild ranks/streaks.
- **Crash safety:** WAL + per-write transactions + per-migration transactions;
  acceptance-tested by closing the DB mid-workout and reopening.
- **Mobile integration (minimal):** `DatabaseProvider` boots SQLite
  synchronously on launch with explicit loading/error(retry) states; the
  Exercises list/detail screens read SQLite repositories. No workout,
  routine, rank, streak or notification UI yet (Phase 4+).

## Decisions log (Phase 4 - Workout Tracker)

- **Service layer:** `WorkoutService`, `RoutineService`, `RestTimerService`
  (`packages/database/src/services`) sit above the repositories; screens go
  UI -> service -> repository -> SQLite and never issue SQL or hold canonical
  state. `createServices()` composes them over one opened database; the
  injectable clock (`now?`) makes time-dependent behavior testable.
- **Reentrant driver transactions:** `DatabaseDriver.transaction()` joins an
  outer transaction when already inside one (both drivers), so services can
  compose repository calls (complete-set = update + dirty markers + rest
  timer) into a single atomic `BEGIN IMMEDIATE`.
- **Schema v2:** `rest_timer` table (one row per profile; authoritative
  `ends_at` timestamp - remaining time always derived, so backgrounding and
  process death are free) and `workout_exercises.targets_json` (routine
  target snapshot copied at start; later routine edits never mutate started
  workouts).
- **Snapshot semantics:** starting from a routine copies order, rest,
  superset groups and per-set targets into the workout. The routine remains
  the template; the workout owns its session structure from that instant.
- **Autosave:** every meaningful mutation (set values on field commit, set
  completion, notes on blur, structure changes) persists immediately. The
  UI keeps only transient input buffers, flushed before completion and on
  finish/unmount. Completed sets are durable without pressing Finish.
- **Rest timer:** service-backed, persisted, +/-15 s and skip are
  transactions; it survives process death (restarted live if `ends_at` is in
  the future, reported as expired otherwise). Notifications are deferred to
  the notifications phase.
- **Recovery:** the hub shows a resume card whenever an active workout
  exists (task T) - never auto-discarded; conflicts raise explicit Resume /
  Discard & start / Cancel choices.
- **Summary and history:** the workout summary is canonical only (duration
  derived from timestamps, completed-set count, exercise count, logged
  volume as a basic training statistic). No PR/rank/streak/achievement
  display exists in Phase 4; history detail is read-only.
- **UI rules:** screens read canonical data through services on every render;
  component state holds only in-progress text inputs and open/closed
  drawers. The exercise picker searches SQLite with rank eligibility shown
  as an indicator only (unsupported/provisional exercises stay fully
  loggable).
## Decisions log (Phase 5 - Personal Records + Ranked Core)

- **Derived-data layer:** new `packages/database/src/derived` -
  `RankingInputBuilder` (pure canonical-to-engine translation),
  PR engine (pure candidate computation), rank projection (engine results ->
  per-scope states + divisions + provenance) and `DerivedDataWorker`
  (queue consumer). `DerivedDataService` exposes read models + the worker
  facade through `createServices`.
- **Schema v3:** `personal_records`, `personal_record_events`,
  `rank_snapshots`, `rank_events` (all with UNIQUE keys that make retries
  and rebuilds idempotent), `exercise_aliases.source_id` (Hevy template
  bridge) and the ranking-walk index `workouts(profile_id, status,
  started_at)`. See docs/DERIVED_STATE.md for the full contract.
- **Two-version provenance:** every snapshot/event stores the frozen engine
  version (`hevy-ranks-compatible-v1`) AND the projection version
  (`openrank-ranking-projection-v1`), so application-level rules (eligibility
  gating, provisional policy, divisions) can evolve without touching the
  engine.
- **Derived processing:** finish-workout -> canonical commit -> worker pass in
  the same UI flow ("Workout saved successfully. Updating records and
  ranks..."); failure downgrades gracefully ("Workout is safely saved. Ranks
  will be recalculated automatically.") and the app-start repair retries.
- **No overall rank, no streaks:** the Ranks tab is the Strength Profile
  (six muscle groups). Scheduled streaks remain Phase 6 per docs/STREAK_SPEC.md.
