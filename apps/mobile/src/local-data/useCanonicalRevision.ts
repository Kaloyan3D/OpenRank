/**
 * useCanonicalRevision (Phase 8.2 P0) - the React side of local-data
 * invalidation.
 *
 * Subscribes the calling component to the LocalDataChangeStore with
 * useSyncExternalStore (the correctness contract: tear-free reads, proper
 * re-subscription, concurrent-safe snapshot). The returned revision is
 * intentionally consumed by the render: when a canonical mutation commits,
 * the revision changes, the screen re-renders, and its synchronous
 * repository/service reads observe fresh canonical SQLite state.
 *
 * Screens keep reading canonical data directly during render - nothing is
 * mirrored into React state, an external state store, or context records.
 */

import { useSyncExternalStore } from "react";
import { localDataChangeStore } from "./LocalDataChangeStore";

// Module-level stable identities: useSyncExternalStore must not re-subscribe
// because a render recreated inline callbacks.
const subscribe = (listener: () => void): (() => void) => localDataChangeStore.subscribe(listener);
const getSnapshot = (): number => localDataChangeStore.getSnapshot();

export function useCanonicalRevision(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
