/**
 * packages/database - SQLite persistence (source of truth).
 *
 * Entry point: openDatabase(driver, catalog?) migrates the schema to the
 * latest version, seeds the bundled catalog (idempotent, transactional) and
 * returns the repository aggregate.
 *
 * Platform adapters live in separate entry points so no bundle ever carries a
 * driver it cannot use:
 * - app runtime: "@openrank/database/expo" (ExpoSqliteDriver, expo-sqlite)
 * - tests/tooling: packages/database/src/node-driver (node:sqlite)
 *
 * IDs: locally owned mutable entities (profiles, routines, workouts, sets,
 * bodyweight entries, dirty markers, custom exercises) use UUIDv7 (RFC 9562)
 * - time-ordered and globally unique, ready for future offline sync. Dataset
 * rows keep their stable canonical ids (fdb:...).
 */

import { uuidv7 } from "@openrank/shared";
import type {
  BodyweightRepository,
  DerivedStateRepository,
  ExerciseRepository,
  ProfileRepository,
  RoutineRepository,
  WorkoutRepository,
} from "@openrank/domain";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import type { DatabaseDriver } from "./driver";
import { migrate } from "./migrations";
import { catalogFingerprint, installedFingerprint, seedCatalog } from "./seed";
import { SqliteProfileRepository, SqliteBodyweightRepository } from "./repositories/profile";
import { SqliteExerciseRepository } from "./repositories/exercise";
import { SqliteRoutineRepository } from "./repositories/routine";
import { SqliteWorkoutRepository } from "./repositories/workout";
import { SqliteDerivedStateRepository } from "./repositories/dirty";

export interface OpenDatabaseResult {
  profile: ProfileRepository;
  bodyweight: BodyweightRepository;
  exercise: ExerciseRepository;
  routine: RoutineRepository;
  workout: WorkoutRepository;
  dirty: DerivedStateRepository;
  /** Schema version after migration (equals SCHEMA_VERSION). */
  schemaVersion: number;
  /** Fingerprint of the seeded catalog, or null when no catalog supplied. */
  catalogFingerprint: string | null;
  /** True when the seed found the same fingerprint already installed. */
  seedUnchanged: boolean | null;
}

export interface OpenDatabaseOptions {
  /** Bundled catalog (app runtime). Omit in tests that only need user data. */
  catalog?: CatalogV1 | undefined;
  /** UUIDv7 generator override (tests inject deterministic ids). */
  newId?: (() => string) | undefined;
}

/**
 * Open the database: migrate, then (optionally) seed the bundled catalog.
 * Reseeding never touches user-created data (custom exercises, routines,
 * workouts, bodyweight, profiles).
 */
export function openDatabase(driver: DatabaseDriver, options: OpenDatabaseOptions = {}): OpenDatabaseResult {
  driver.exec("PRAGMA foreign_keys = ON");
  driver.exec("PRAGMA journal_mode = WAL");
  const version = migrate(driver);

  const newId = options.newId ?? (() => uuidv7(Date.now()));

  const dirty = new SqliteDerivedStateRepository(driver, newId);
  const profile = new SqliteProfileRepository(driver, dirty, newId);
  const bodyweight = new SqliteBodyweightRepository(driver, dirty, newId);
  const exercise = new SqliteExerciseRepository(driver, newId);
  const routine = new SqliteRoutineRepository(driver, newId);
  const workout = new SqliteWorkoutRepository(driver, dirty, newId);

  let fingerprint: string | null = null;
  let seedUnchanged: boolean | null = null;
  if (options.catalog) {
    fingerprint = catalogFingerprint(options.catalog);
    const stats = seedCatalog(driver, options.catalog, {
      fingerprint,
      seededAtUtc: new Date().toISOString(),
    });
    seedUnchanged = stats.unchanged;
  }

  return {
    profile, bodyweight, exercise, routine, workout, dirty,
    schemaVersion: version,
    catalogFingerprint: fingerprint ?? installedFingerprint(driver),
    seedUnchanged,
  };
}

export { SCHEMA_VERSION, MIGRATIONS, migrate, schemaVersion } from "./migrations";
export { catalogFingerprint, installedFingerprint, seedCatalog, stableHash } from "./seed";
export type { SeedOptions, SeedStats } from "./seed";
export type { DatabaseDriver, SqlParam, SqlRow } from "./driver";