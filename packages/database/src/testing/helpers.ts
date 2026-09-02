/** Shared test helpers: in-memory database + the committed catalog fixture. */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import { NodeSqliteDriver } from "../node-driver";
import { openDatabase, type OpenDatabaseResult } from "../index";

const here = dirname(fileURLToPath(import.meta.url));
export const catalog = JSON.parse(
  readFileSync(join(here, "../../../exercise-catalog/data/catalog.v1.json"), "utf8"),
) as CatalogV1;

export interface TestDb {
  driver: NodeSqliteDriver;
  repos: OpenDatabaseResult;
}

/** Fresh in-memory database (migrated + optionally seeded). */
export function openTestDb(withCatalog = true): TestDb {
  const driver = new NodeSqliteDriver(":memory:");
  const repos = openDatabase(driver, withCatalog ? { catalog } : {});
  return { driver, repos };
}

/** File-backed database in a temp dir (crash/reopen tests). */
export interface TestFileDb extends TestDb {
  path: string;
  dir: string;
}

export function openTestFileDb(): TestFileDb {
  const dir = mkdtempSync(join(tmpdir(), "openrank-db-"));
  const path = join(dir, "openrank.db");
  const driver = new NodeSqliteDriver(path);
  const repos = openDatabase(driver, { catalog });
  return { path, dir, driver, repos };
}

export function cleanupFileDb(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Deterministic test ids (seq counter -> uuidv7-shape not required in tests). */
export function testIdFactory(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return "test-id-" + String(n).padStart(6, "0");
  };
}

export function deterministicRepos(): { driver: NodeSqliteDriver; repos: OpenDatabaseResult } {
  const driver = new NodeSqliteDriver(":memory:");
  const repos = openDatabase(driver, { catalog, newId: testIdFactory() });
  return { driver, repos };
}