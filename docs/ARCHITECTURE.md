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