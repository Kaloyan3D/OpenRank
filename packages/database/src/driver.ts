/**
 * Minimal synchronous SQLite driver abstraction.
 *
 * The database package is platform-agnostic: repositories, migrations, and
 * seeding operate on this interface. Two adapters implement it:
 * - ExpoSqliteDriver (expo-sqlite) - the app runtime.
 * - NodeSqliteDriver (node:sqlite) - tests and tooling (dev-only).
 *
 * Parameters bind as string | number | null (SQLite's native types); booleans
 * are persisted as 0/1 by the row mappers.
 */

export type SqlParam = string | number | null;

export interface SqlRow {
  [column: string]: SqlParam | undefined;
}

export interface DatabaseDriver {
  /** Execute one or more statements without parameters (DDL, pragmas). */
  exec(sql: string): void;
  /** Run a parameterized statement; returns affected row count. */
  run(sql: string, params?: readonly SqlParam[]): { changes: number };
  /** First row or undefined. */
  get(sql: string, params?: readonly SqlParam[]): SqlRow | undefined;
  /** All rows. */
  all(sql: string, params?: readonly SqlParam[]): SqlRow[];
  /**
   * Run fn inside BEGIN IMMEDIATE ... COMMIT; rolls back on throw. Drivers
   * must reject nested calls (the repositories never nest).
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Helper: bind a boolean as SQLite integer. */
export const b = (v: boolean): number => (v ? 1 : 0);

/** Helper: read a boolean integer column. */
export const toBool = (v: SqlParam | undefined): boolean => v === 1 || v === "1";

/** Helper: read a nullable string column. */
export const asStr = (v: SqlParam | undefined): string | null => (v == null ? null : String(v));