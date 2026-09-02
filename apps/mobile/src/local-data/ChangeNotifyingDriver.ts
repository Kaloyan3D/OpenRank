/**
 * ChangeNotifyingDriver (Phase 8.2 P0) - the mutation/invalidation boundary.
 *
 * Decorates the platform DatabaseDriver so every successful canonical write
 * on the single app connection publishes a LocalDataChangeStore revision.
 * Placing the hook at the driver level (below repositories and services)
 * makes invalidation complete by construction: no screen, service, or future
 * mutation can bypass it, and a developer adding a service mutation never
 * has to remember to refresh any screen.
 *
 * Ordering guarantees (the P0 contract):
 * - run()/exec() publish only after the statement succeeded.
 * - transaction() publishes ONCE after the outermost commit succeeds
 *   (reentrant nested transactions stay silent; one logical operation is
 *   one invalidation, never 30).
 * - A failed statement or a rolled-back transaction publishes NOTHING -
 *   the UI is never told canonical state changed when it did not.
 * - Reads (get/all) are inert.
 */

import type { DatabaseDriver, SqlParam, SqlRow } from "@openrank/database";

export class ChangeNotifyingDriver implements DatabaseDriver {
  /** Depth of the transaction currently open THROUGH this wrapper. */
  private depth = 0;

  constructor(
    private readonly inner: DatabaseDriver,
    private readonly onWrite: () => void,
  ) {}

  exec(sql: string): void {
    this.inner.exec(sql);
    this.notifyWrite();
  }

  run(sql: string, params: readonly SqlParam[] = []): { changes: number } {
    const result = this.inner.run(sql, params);
    this.notifyWrite();
    return result;
  }

  get(sql: string, params: readonly SqlParam[] = []): SqlRow | undefined {
    return this.inner.get(sql, params);
  }

  all(sql: string, params: readonly SqlParam[] = []): SqlRow[] {
    return this.inner.all(sql, params);
  }

  transaction<T>(fn: () => T): T {
    // Reentrant join: the outermost transaction owns the publication.
    if (this.depth > 0) return this.inner.transaction(fn);
    this.depth = 1;
    let out: T;
    try {
      out = this.inner.transaction(fn);
    } finally {
      this.depth = 0;
    }
    // The outermost transaction committed successfully - canonical state
    // changed exactly once for this logical operation; publish exactly once.
    // (A throw above never reaches this line: rollback publishes nothing.)
    this.notifyWrite();
    return out;
  }

  close(): void {
    this.inner.close();
  }

  private notifyWrite(): void {
    if (this.depth === 0) this.onWrite();
  }
}
