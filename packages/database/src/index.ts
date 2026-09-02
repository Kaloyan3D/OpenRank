/**
 * @openrank/database - SQLite access layer.
 *
 * Status: Phase 3 (not yet implemented). The full schema contract lives in
 * docs/DATABASE.md. This package will own:
 *
 * - connection lifecycle (foreign keys ON, WAL mode, per-connection)
 * - versioned SQL migrations
 * - transactional repositories (the only code that touches SQLite)
 * - the derived-data dirty queue
 *
 * No other package may import expo-sqlite or speak SQL.
 */
export const DATABASE_SCHEMA_VERSION = 0;
