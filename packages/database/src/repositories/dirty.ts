/**
 * Derived-state dirty queue (SQLite implementation).
 *
 * Canonical workout/bodyweight writes insert markers in the SAME transaction
 * as the canonical row, so a crash can never produce a derived cache that
 * silently diverges. Markers are durable (they survive process restarts) and
 * Phase 5's DerivedDataWorker will consume + clear them. No recalculation
 * happens in Phase 3.
 */

import type { DerivedDirtyRecord, DerivedStateRepository } from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { nowUtc } from "../rows";

export class SqliteDerivedStateRepository implements DerivedStateRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly newId: () => string,
  ) {}

  mark(
    profileId: string | null,
    entityType: DerivedDirtyRecord["entityType"],
    entityId: string,
    reason: DerivedDirtyRecord["reason"],
  ): void {
    // UNIQUE(entity_type, entity_id, reason): re-marking is idempotent.
    this.driver.run(
      "INSERT OR IGNORE INTO derived_dirty (id, profile_id, entity_type, entity_id, reason, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
      [this.newId(), profileId, entityType, entityId, reason, nowUtc()],
    );
  }

  list(profileId?: string | null): DerivedDirtyRecord[] {
    const where = profileId === undefined ? "" : profileId === null ? "WHERE profile_id IS NULL" : "WHERE profile_id = ?";
    const params = profileId === undefined || profileId === null ? [] : [profileId];
    return this.driver
      .all("SELECT * FROM derived_dirty " + where + " ORDER BY created_at, id", params)
      .map((row) => ({
        id: String(row.id),
        profileId: row.profile_id == null ? null : String(row.profile_id),
        entityType: String(row.entity_type) as DerivedDirtyRecord["entityType"],
        entityId: String(row.entity_id),
        reason: String(row.reason) as DerivedDirtyRecord["reason"],
        createdAt: String(row.created_at),
      }));
  }

  count(profileId?: string | null): number {
    const where = profileId === undefined ? "" : profileId === null ? "WHERE profile_id IS NULL" : "WHERE profile_id = ?";
    const params = profileId === undefined || profileId === null ? [] : [profileId];
    const row = this.driver.get("SELECT COUNT(*) AS n FROM derived_dirty " + where, params);
    return Number(row?.n ?? 0);
  }

  clear(ids: string[]): void {
    if (ids.length === 0) return;
    this.driver.transaction(() => {
      for (const id of ids) {
        this.driver.run("DELETE FROM derived_dirty WHERE id = ?", [id]);
      }
    });
  }

  clearAll(): void {
    this.driver.run("DELETE FROM derived_dirty");
  }
}
