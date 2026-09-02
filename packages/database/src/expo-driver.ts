/**
 * Expo SQLite driver - the app runtime adapter.
 *
 * Wraps expo-sqlite's synchronous API behind the platform-agnostic
 * DatabaseDriver contract (the same contract the Node test driver implements,
 * so the repository suite runs against real SQLite in CI).
 */

import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { uuidv7From } from "@openrank/shared";
import type { DatabaseDriver, SqlParam, SqlRow } from "./driver";

export const DATABASE_FILE = "openrank.db";

export class ExpoSqliteDriver implements DatabaseDriver {
  readonly kind = "expo" as const;
  private readonly db: SQLiteDatabase;
  private inTransaction = false;

  private constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  /** Open (creating if needed) + enable foreign keys and WAL. */
  static open(path: string = DATABASE_FILE): ExpoSqliteDriver {
    const db = openDatabaseSync(path);
    db.execSync("PRAGMA foreign_keys = ON");
    db.execSync("PRAGMA journal_mode = WAL");
    return new ExpoSqliteDriver(db);
  }

  exec(sql: string): void {
    this.db.execSync(sql);
  }

  run(sql: string, params: readonly SqlParam[] = []): { changes: number } {
    const result = this.db.runSync(sql, params as never[]);
    return { changes: Number(result.changes) };
  }

  get(sql: string, params: readonly SqlParam[] = []): SqlRow | undefined {
    const row = this.db.getFirstSync(sql, params as never[]) as Record<string, unknown> | null;
    return row == null ? undefined : normalizeRow(row);
  }

  all(sql: string, params: readonly SqlParam[] = []): SqlRow[] {
    const rows = this.db.getAllSync(sql, params as never[]) as Record<string, unknown>[];
    return rows.map((row) => normalizeRow(row));
  }

  transaction<T>(fn: () => T): T {
    // Reentrant: nested calls join the open transaction instead of failing.
    if (this.inTransaction) return fn();
    this.inTransaction = true;
    let out!: T;
    try {
      this.db.withTransactionSync(() => {
        out = fn();
      });
      return out;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.db.closeSync();
  }
}

function normalizeRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v == null || typeof v === "string" || typeof v === "number" ? v : String(v);
  }
  return out;
}

/** New UUIDv7 using expo-crypto randomness. */
export function newExpoId(): string {
  return uuidv7From(Date.now(), (n) => {
    const bytes = new Uint8Array(n);
    Crypto.getRandomValues(bytes);
    return bytes;
  });
}