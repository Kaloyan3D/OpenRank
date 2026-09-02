import { describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "./node-driver";
import { MIGRATIONS, migrate, schemaVersion, SCHEMA_VERSION } from "./migrations";
import { openTestDb, openTestFileDb } from "./testing/helpers";

describe("migrations", () => {
  it("applies the latest schema (v" + String(SCHEMA_VERSION) + ") to an empty database", () => {
    const { driver, repos } = openTestDb();
    expect(repos.schemaVersion).toBe(SCHEMA_VERSION);
    expect(schemaVersion(driver)).toBe(SCHEMA_VERSION);

    const tables = driver
      .all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((r) => String(r.name));
    for (const expected of [
      "profiles", "bodyweight_entries", "exercises", "muscles", "exercise_muscles",
      "exercise_aliases", "exercise_instructions", "exercise_media",
      "routines", "routine_exercises", "routine_set_targets",
      "workouts", "workout_exercises", "workout_sets", "rest_timer",
      "imports", "derived_dirty", "catalog_meta",
    ]) {
      expect(tables, expected).toContain(expected);
    }
  });

  it("is idempotent: repeated migration execution is a no-op", () => {
    const { driver } = openTestDb();
    expect(migrate(driver)).toBe(SCHEMA_VERSION);
    expect(migrate(driver)).toBe(SCHEMA_VERSION);
    expect(migrate(driver)).toBe(SCHEMA_VERSION);
    expect(schemaVersion(driver)).toBe(SCHEMA_VERSION);
  });

  it("migrations are contiguous, versioned, and non-empty", () => {
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.statements.length).toBeGreaterThan(0);
    });
  });

  it("rolls back a failed migration transaction (no partial DDL)", () => {
    const driver = new NodeSqliteDriver(":memory:");
    expect(() =>
      driver.transaction(() => {
        driver.exec("CREATE TABLE rollback_probe (id TEXT PRIMARY KEY)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const tables = driver.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'",
    );
    expect(tables).toHaveLength(0);
    driver.close();
  });

  it("enables foreign keys on every connection", () => {
    const { driver } = openTestDb();
    expect(Number(driver.get("PRAGMA foreign_keys")?.foreign_keys)).toBe(1);
  });

  it("uses WAL journal mode on a file-backed database", () => {
    // In-memory SQLite cannot switch journal modes ("memory" always), so the
    // WAL assertion runs against a real file database.
    const { path } = openTestFileDb();
    const fileDriver = new NodeSqliteDriver(path);
    try {
      const mode = String(fileDriver.get("PRAGMA journal_mode")?.journal_mode);
      expect(mode.toLowerCase()).toBe("wal");
      expect(Number(fileDriver.get("PRAGMA foreign_keys")?.foreign_keys)).toBe(1);
    } finally {
      fileDriver.close();
    }
  });
});