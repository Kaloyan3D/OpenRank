/**
 * Catalog seeding (Phase 3): loads the bundled Phase 2 catalog into SQLite.
 *
 * Requirements (spec section 54 + Phase 3 task G):
 * - deterministic: pure hash fingerprint; stable row ids for aliases/media;
 * - idempotent: reseeding the same catalog changes nothing (rows are
 *   content-compared before update; no duplicate rows);
 * - transaction-based: seed runs in a single transaction;
 * - safe after every app update: dataset rows are upserted by stable
 *   canonical id (INSERT ... ON CONFLICT DO UPDATE - never REPLACE, which
 *   would delete+reinsert and break foreign keys);
 * - preserves user data: user-created exercises (is_custom = 1), their
 *   aliases, and everything referencing exercises (routines, workouts) are
 *   untouched; only dataset-owned rows are refreshed;
 * - no network access.
 */

import type { DatabaseDriver } from "./driver";
import type { CatalogV1 } from "@openrank/exercise-catalog";

export interface SeedOptions {
  /** Change-detection key of the bundled catalog (see catalogFingerprint). */
  fingerprint: string;
  /** ISO-8601 UTC instant of this seed run (new rows only). */
  seededAtUtc: string;
}

export interface SeedStats {
  muscles: number;
  exercises: number;
  exerciseMuscles: number;
  aliases: number;
  instructions: number;
  media: number;
  /** True when the installed fingerprint already matched (no-op seed). */
  unchanged: boolean;
}

export const CATALOG_SOURCE_NAME = "free-exercise-db";

/**
 * Deterministic 64-bit-ish hash (two independent FNV-1a variants) over a
 * string. Platform-independent and stable - used to derive stable row ids for
 * dataset aliases/media and the catalog fingerprint (change detection, not a
 * cryptographic checksum).
 */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + Math.imul(c + i, 0x85ebca6b)) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
  );
}

/** Fingerprint of a catalog object (order-independent over exercise ids). */
export function catalogFingerprint(catalog: CatalogV1): string {
  const parts = [
    "v" + String(catalog.schemaVersion),
    catalog.source.name + ":" + catalog.source.commit + ":" + catalog.source.datasetSha256,
    catalog.exercises.map((e) => e.id + "|" + e.ranking.support).join(";"),
  ];
  return stableHash(parts.join("\u0000"));
}

/** Stable id for a dataset alias row (same input -> same id across reseeds). */
function aliasRowId(exerciseId: string, normalizedAlias: string, source: string): string {
  return "al_" + stableHash(exerciseId + "\u0000" + normalizedAlias + "\u0000" + source);
}

/** Stable id for a dataset media row. */
function mediaRowId(exerciseId: string, remoteUrl: string): string {
  return "md_" + stableHash(exerciseId + "\u0000" + remoteUrl);
}

interface MetaRow {
  key: string;
  value: string;
}

function readMeta(driver: DatabaseDriver, key: string): string | null {
  const row = driver.get("SELECT value FROM catalog_meta WHERE key = ?", [key]) as MetaRow | undefined;
  return row?.value == null ? null : String(row.value);
}

function writeMeta(driver: DatabaseDriver, key: string, value: string): void {
  driver.run(
    "INSERT INTO catalog_meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** Seed (or refresh) the bundled catalog. Safe to run on every app update. */
export function seedCatalog(driver: DatabaseDriver, catalog: CatalogV1, options: SeedOptions): SeedStats {
  const existingFingerprint = readMeta(driver, "fingerprint");
  const fingerprint = options.fingerprint;
  const seededAt = options.seededAtUtc;
  const imageBase = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/" + catalog.source.commit + "/";

  const stats: SeedStats = {
    muscles: 0,
    exercises: 0,
    exerciseMuscles: 0,
    aliases: 0,
    instructions: 0,
    media: 0,
    unchanged: existingFingerprint === fingerprint,
  };

  driver.transaction(() => {
    // 1. Dataset-owned child rows (user customs are is_custom = 1 and keep
    //    their aliases/junctions; everything referencing exercises survives).
    driver.run(
      "DELETE FROM exercise_aliases WHERE exercise_id IN (SELECT id FROM exercises WHERE is_custom = 0)",
    );
    driver.run(
      "DELETE FROM exercise_instructions WHERE exercise_id IN (SELECT id FROM exercises WHERE is_custom = 0)",
    );
    driver.run(
      "DELETE FROM exercise_media WHERE exercise_id IN (SELECT id FROM exercises WHERE is_custom = 0)",
    );
    driver.run(
      "DELETE FROM exercise_muscles WHERE exercise_id IN (SELECT id FROM exercises WHERE is_custom = 0)",
    );

    // 2+3. Muscles are catalog-owned but UPSERTED (never deleted): the table
    // behaves like a stable enum, and user custom exercises may reference
    // muscles, so RESTRICT must never block a reseed. New catalog muscles are
    // added, existing ones updated, nothing removed.
    for (const m of [...catalog.muscles].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
      driver.run(
        "INSERT INTO muscles (id, name, major_group) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET name = excluded.name, major_group = excluded.major_group",
        [m.id, m.name, m.majorGroup],
      );
      stats.muscles += 1;
    }

    // 4. Exercises: content-compared upsert by canonical id (never REPLACE).
    for (const e of catalog.exercises) {
      const existing = driver.get(
        "SELECT slug, name, category, mechanic, force, equipment, tracking_type, source, source_id, " +
          "ranking_eligibility, ranking_strategy, ranking_group, ranking_reason " +
          "FROM exercises WHERE id = ?",
        [e.id],
      );
      if (!existing) {
        driver.run(
          "INSERT INTO exercises (id, slug, name, category, mechanic, force, equipment, tracking_type, " +
            "is_custom, source, source_id, ranking_eligibility, ranking_strategy, ranking_group, " +
            "ranking_reason, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)",
          [e.id, e.slug, e.name, e.category, e.mechanic, e.force, e.equipment, e.trackingType,
            e.source, e.sourceId, e.ranking.support, e.ranking.strategy, e.ranking.engineGroup,
            e.ranking.reason, seededAt, seededAt],
        );
      } else {
        // Content-compared update: reseeding an identical catalog is a no-op.
        const differs =
          String(existing.slug) !== e.slug ||
          String(existing.name) !== e.name ||
          String(existing.category) !== e.category ||
          (existing.mechanic == null ? null : String(existing.mechanic)) !== e.mechanic ||
          (existing.force == null ? null : String(existing.force)) !== e.force ||
          (existing.equipment == null ? null : String(existing.equipment)) !== e.equipment ||
          String(existing.tracking_type) !== e.trackingType ||
          String(existing.source) !== e.source ||
          (existing.source_id == null ? null : String(existing.source_id)) !== e.sourceId ||
          String(existing.ranking_eligibility) !== e.ranking.support ||
          String(existing.ranking_strategy) !== e.ranking.strategy ||
          (existing.ranking_group == null ? null : String(existing.ranking_group)) !== e.ranking.engineGroup ||
          (existing.ranking_reason == null ? null : String(existing.ranking_reason)) !== e.ranking.reason;
        if (differs) {
          driver.run(
            "UPDATE exercises SET slug = ?, name = ?, category = ?, mechanic = ?, force = ?, equipment = ?, " +
              "tracking_type = ?, source = ?, source_id = ?, ranking_eligibility = ?, " +
              "ranking_strategy = ?, ranking_group = ?, ranking_reason = ?, updated_at = ? WHERE id = ?",
            [e.slug, e.name, e.category, e.mechanic, e.force, e.equipment, e.trackingType,
              e.source, e.sourceId, e.ranking.support, e.ranking.strategy, e.ranking.engineGroup,
              e.ranking.reason, seededAt, e.id],
          );
        }
      }
      stats.exercises += 1;
    }

    // 5. Junctions, aliases, instructions, media (deterministic ids).
    for (const e of catalog.exercises) {
      for (const muscleId of e.primaryMuscles) {
        driver.run(
          "INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, 'primary')",
          [e.id, muscleId],
        );
        stats.exerciseMuscles += 1;
      }
      for (const muscleId of e.secondaryMuscles) {
        driver.run(
          "INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, 'secondary')",
          [e.id, muscleId],
        );
        stats.exerciseMuscles += 1;
      }
      e.instructions.forEach((step, i) => {
        driver.run(
          "INSERT INTO exercise_instructions (exercise_id, position, step) VALUES (?, ?, ?)",
          [e.id, i, step],
        );
        stats.instructions += 1;
      });
      for (const path of e.images) {
        const remoteUrl = imageBase + path;
        driver.run(
          "INSERT INTO exercise_media (id, exercise_id, kind, local_path, remote_url, source, license, attribution) " +
            "VALUES (?, ?, 'image', NULL, ?, ?, ?, NULL)",
          [mediaRowId(e.id, remoteUrl), e.id, remoteUrl, CATALOG_SOURCE_NAME, catalog.source.license],
        );
        stats.media += 1;
      }
    }

    for (const a of catalog.aliases) {
      driver.run(
        "INSERT INTO exercise_aliases (id, exercise_id, alias, normalized_alias, locale, source) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
        [aliasRowId(a.exerciseId, a.normalizedAlias, a.source), a.exerciseId, a.alias, a.normalizedAlias, a.locale, a.source],
      );
      stats.aliases += 1;
    }

    // 6. Bookkeeping.
    writeMeta(driver, "fingerprint", fingerprint);
    writeMeta(driver, "catalog_schema_version", String(catalog.schemaVersion));
    writeMeta(driver, "ranking_compatibility", catalog.rankingCompatibility);
    writeMeta(driver, "dataset_commit", catalog.source.commit);
    writeMeta(driver, "seeded_at", seededAt);
  });

  return stats;
}

/** The installed catalog fingerprint, or null before the first seed. */
export function installedFingerprint(driver: DatabaseDriver): string | null {
  return readMeta(driver, "fingerprint");
}