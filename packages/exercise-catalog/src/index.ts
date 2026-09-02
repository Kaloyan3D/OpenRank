/**
 * @openrank/exercise-catalog - canonical exercise catalog.
 *
 * Status: Phase 2 (not yet implemented). Will own:
 *
 * - the bundled catalog.v1.json (built from the pinned Free Exercise DB)
 * - validation + normalization pipeline (scripts/build-exercise-catalog.ts)
 * - muscle mapping (relational, primary/secondary)
 * - aliases (normalized, multilingual) + exercise search + details
 *
 * The dataset is pinned in datasets/sources.lock.json and never
 * runtime-fetched. See docs/DATA_SOURCES.md.
 */
export const EXERCISE_CATALOG_VERSION = "0.0.0-scaffold";
