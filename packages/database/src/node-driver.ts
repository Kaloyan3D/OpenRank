/**
 * Node.js driver (node:sqlite DatabaseSync) - dev/test tooling only.
 *
 * Lets the ENTIRE repository, migration, and seed suite run in vitest/CI
 * against real SQLite without an emulator. The app runtime uses
 * ExpoSqliteDriver; both satisfy the same DatabaseDriver contract.
 */

import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { uuidv7From } from "@openrank/shared";
import type { DatabaseDriver, SqlParam, SqlRow } from "./driver";

interface NodeStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export class NodeSqliteDriver implements DatabaseDriver {
  readonly kind = "node" as const;
  private readonly db: DatabaseSync;
  private inTransaction = false;

  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(path, { open: true, readOnly: options.readOnly === true });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlParam[] = []): { changes: number } {
    const stmt = this.db.prepare(sql) as unknown as NodeStatement;
    const result = stmt.run(...params);
    return { changes: Number(result.changes) };
  }

  get(sql: string, params: readonly SqlParam[] = []): SqlRow | undefined {
    const stmt = this.db.prepare(sql) as unknown as NodeStatement;
    const row = stmt.get(...params);
    return row == null ? undefined : normalizeRow(row);
  }

  all(sql: string, params: readonly SqlParam[] = []): SqlRow[] {
    const stmt = this.db.prepare(sql) as unknown as NodeStatement;
    return stmt.all(...params).map((row) => normalizeRow(row as Record<string, unknown>));
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) throw new Error("nested transactions are not supported");
    this.inTransaction = true;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* the failed statement already aborted the transaction */
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    this.db.close();
  }
}

function normalizeRow(row: Record<string, unknown>): SqlRow {
  const out: SqlRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v == null || typeof v === "string" || typeof v === "number" ? v : String(v);
  }
  return out;
}

/** New UUIDv7 using node crypto randomness. */
export function newNodeId(): string {
  return uuidv7From(Date.now(), (n) => randomBytes(n));
}