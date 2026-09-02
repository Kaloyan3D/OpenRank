/**
 * LocalDataChangeStore (Phase 8.2 P0) - app-wide canonical-data invalidation.
 *
 * SQLite stays the ONLY canonical state. This store holds invalidation
 * metadata exclusively: a monotonically increasing revision that advances
 * AFTER a successful canonical persistence (never before, never on failure).
 * It stores no domain records - consumers re-read canonical SQLite when the
 * revision they rendered with is no longer current.
 *
 * React subscription model (screens):
 *
 *   canonical mutation -> SQLite commit -> publish() -> revision++
 *     -> useSyncExternalStore -> screen re-renders -> re-reads repositories
 *
 * Design notes:
 * - Global revision first (Phase 8.2 safety model): every successful
 *   canonical mutation invalidates every data-driven consumer. This is the
 *   only version that provably leaves no stale screen; topic-level routing
 *   is a future, evidence-driven optimization - never a correctness device.
 * - A throwing listener is isolated so one broken consumer can never corrupt
 *   the mutation path that just committed.
 */

export type LocalDataChangeListener = () => void;

export class LocalDataChangeStore {
  private revision = 0;
  private readonly listeners = new Set<LocalDataChangeListener>();

  /** Register a change listener; returns its unsubscribe function. */
  subscribe(listener: LocalDataChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current canonical revision (stable between publishes; useSyncExternalStore-safe). */
  getSnapshot(): number {
    return this.revision;
  }

  /**
   * Advance the revision and notify subscribers. Call ONLY after the
   * canonical persistence has succeeded (post-commit).
   */
  publish(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* one broken listener never blocks the others or the mutator */
      }
    }
  }
}

/** The app-wide singleton (one database connection, one invalidation stream). */
export const localDataChangeStore = new LocalDataChangeStore();
