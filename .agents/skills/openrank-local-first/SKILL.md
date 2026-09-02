---
name: openrank-local-first
description: >
  Use whenever modifying OpenRank SQLite schema/queries, repositories,
  services, React state synchronization, workouts, history, profile,
  bodyweight, ranks, streaks, notifications, cross-screen state, persistence,
  or UI refresh behavior — especially when debugging stale UI such as
  "data/exercise was added to SQLite but only appears after an app restart".
  Encodes the canonical persist-then-invalidate-then-reread flow and forbids
  restart workarounds, remount-as-sync, and whole-database copies into JS
  state. Not needed for tasks that touch no persisted state or screen
  refresh.
---

# OpenRank Local-First Data Flow

## Canonical invariant

SQLite is authoritative for persisted application state. Mounted UI is a
projection of SQLite, never a second source of truth.

## Correct mutation flow

```
UI intent
→ service-layer mutation
→ successful SQLite transaction
→ publish lightweight invalidation/revision signal
→ subscribed mounted UI rerenders
→ canonical state is reread from SQLite
```

The invalidation layer is NOT a second domain database. Prefer lightweight
revision/invalidation metadata over duplicating the SQLite domain into
Redux/Zustand/global React state: the signal says "ranks changed", screens
then reread ranks from SQLite.

## Never valid fixes

- "Restart the app to see the change."
- Route remount as the primary synchronization mechanism.
- Arbitrary local nonce hacks per screen.
- Stale cached domain objects becoming authoritative.
- Duplicating the complete SQLite database into a JS state store.
- Direct repository/database writes from random UI surfaces when a service
  boundary should own the mutation.

## Ordering rule

Publish invalidation only AFTER successful canonical persistence. On
transaction failure the UI must not pretend persisted state changed: surface
the error and leave the projection consistent with SQLite.

Focus/reload effects are acceptable as defense-in-depth but must never
replace reactive correctness: a correct flow works on a screen that never
refocuses.

## Debugging stale UI — required sequence

1. Reproduce without restarting the app.
2. Identify the canonical mutation path (which service owns the write).
3. Verify the SQLite transaction actually succeeds.
4. Verify invalidation/revision is published after that success.
5. Verify the mounted consumer subscribes to that signal.
6. Verify the consumer rereads canonical SQLite state on invalidation.
7. Add permanent regression coverage that fails under the old bug (no
   restart, no remount, no refocus).

## Strong trigger examples

- "Exercise was added but does not appear until app restart."
- "Streak only updates after navigating to a different screen."
- "After editing a set, history shows stale values until remount."

## Interaction

- Pair with `react-native-best-practices` for re-render performance work.
- Pair with a test-hardening skill (e.g. `test-driven-hardening` if
  available) for the regression-coverage step.
- Pair with `openrank-product-invariants` when the change touches data
  ownership or persistence architecture.
