# Reactive Local Data (Phase 8.2 P0)

App-wide canonical invalidation: how mounted React screens observe SQLite
changes without restarts, navigation refreshes, or per-screen nonce hacks.

## The contract

1. **SQLite is the only canonical state.** React holds transient UI state
   only (open/closed drawers, in-progress text inputs, OS permission
   status). No domain record is ever mirrored into Redux, Zustand, a
   context, MobX, or any other persistence cache. The canonical-data
   duplication approach was rejected deliberately: two sources of truth
   inevitably diverge (partial mirrors, stale hydrations, double writes),
   and reconciling them reintroduces exactly the staleness this P0 removes.

2. **One shared invalidation architecture.** A single
   `LocalDataChangeStore` (apps/mobile/src/local-data/) carries ONLY
   invalidation metadata - a monotonically increasing global revision. It
   stores no domain records and imports nothing from @openrank/*.

3. **Mutation -> commit -> publish.** The revision advances only AFTER the
   canonical persistence has succeeded. A failed statement or a rolled-back
   transaction publishes nothing - the UI is never told canonical state
   changed when it did not.

4. **React subscribes with useSyncExternalStore.** `useCanonicalRevision()`
   subscribes the calling component to the store; the returned revision is
   intentionally consumed by the render, so a commit re-renders every
   mounted consumer, and each consumer's synchronous repository/service
   reads then observe fresh canonical SQLite.

```text
             SQLite
                |
      successful canonical mutation
                |  (ChangeNotifyingDriver, post-commit)
                v
      LocalDataChangeStore  (revision++ - invalidation metadata ONLY)
                |
        useSyncExternalStore  (useCanonicalRevision)
                |
          React screens re-render
                |
      re-read canonical SQLite (repos/services, synchronous)
```

## Why the publish hook lives at the driver boundary

`ChangeNotifyingDriver` decorates the platform `DatabaseDriver` (the same
contract implemented by ExpoSqliteDriver in the app and NodeSqliteDriver in
tests). DatabaseProvider wraps the single app connection with it at boot:

- **Complete by construction.** Every canonical write - through a
  repository, a service, the derived worker, the streak projection, or the
  notification reconciler - crosses the driver. No screen, service, or
  future mutation can bypass invalidation, and a developer adding a new
  service mutation never has to remember to refresh any screen.
- **Ordering is enforced once, in one place.** `run()`/`exec()` publish
  only after the statement succeeds. `transaction()` publishes ONCE after
  the outermost commit succeeds; reentrant nested transactions (services
  composing repository calls) stay silent. One logical operation is one
  invalidation - never thirty.
- **Reads are inert.** `get`/`all` never publish. (A transaction that only
  reads still publishes once on commit; that is harmless - it costs one
  extra re-render and never leaves stale state.)

A throwing listener is isolated inside `publish()` so one broken consumer
can never corrupt the mutation path that just committed.

## Global revision first (safety model)

Phase 8.2 uses a GLOBAL revision on purpose. Every successful canonical
mutation invalidates every data-driven consumer. This is the only version
that provably leaves no stale screen; the dataset is local and SQLite reads
are synchronous and fast, so the extra reads on mounted tab screens are
acceptable (measured: smooth). Topic-level routing (workout / history /
profile / ...) is a possible future optimization - it must never become a
correctness device, and it is intentionally NOT implemented until profiling
proves global invalidation problematic.

## Service mutation policy

UI -> services -> repositories -> SQLite. Screens READ repositories/services
directly during render (accepted, synchronous, local). Screens never WRITE
canonical data through a repository:

- UI canonical writes MUST go through a service method. The service owns
  validation and transactional composition; the repository owns SQL.
- This is enforced by a permanent source-level architecture test
  (apps/mobile/tests/reactive-local-data.test.ts): any
  `repos.<domain>.<mutator>(` call or raw `db.run/exec/transaction` in
  apps/mobile/src/{app,features,components,ui,hooks} fails the suite.
- Fixed violations (Phase 8.2): the exercise picker wrote
  `repos.workout.addExercise` directly; the Profile tab wrote
  `repos.bodyweight.add`, `repos.profile.updateStrengthStandard` and
  `repos.profile.updateUnitSystem`. All now flow through WorkoutService /
  ProfileService. Documented exceptions: none.

New service methods added for this policy (behavior-preserving delegation):

- `WorkoutService.addExercise(workoutId, input)`
- `ProfileService.addBodyweight(profileId, weightKg, measuredAtUtc, note?)`

## Derived processing and background writers

Derived processors are first-class invalidation producers because they
change user-visible state. Because the hook is at the driver boundary, this
works without any special-casing:

```text
finish workout
  -> workout canonical change (1 transaction, 1 publish)
  -> derived PR/rank processing (publishes per derived commit)
  -> streak processing (publishes per ledger commit)
  -> notification reconcile (async; publishes per preference/ledger commit)
```

Home, History, Ranks, Progress, Profile and Streak are mounted tab screens;
each subscribes to the revision, so all of them settle on fresh canonical
data without restart, without navigation, and without ever settling on an
intermediate stale state. Publishing more than once across a multi-step
logical flow is acceptable; publishing nothing on failure is not.

## Navigation, tabs and focus

Expo Router keeps tab screens mounted. The shared revision is the PRIMARY
mechanism: a mounted screen re-renders when canonical data changes, whether
the mutation came from this screen, a sibling tab, or a nested route that
has since popped (picker -> back, bodyweight editor -> back, routine
editor -> back).

`useFocusEffect` / focus-refresh rereads are permitted as SECONDARY defense
in depth only - never the architecture - because multiple mounted screens
may depend on the same mutation. Currently no focus refresh is needed: the
revision covers every audited flow.

## Local refresh patchwork

Per-screen nonce/refresh state (`setNonce`, `reloadKey`) was removed
wherever it existed to compensate for canonical staleness (Home, Workout
hub, Active Workout, Profile, History, Ranks, Progress, Schedule,
Reschedule, Routine editor, Routines list, Notifications, Streak,
Achievements, unit conversions, root RoutingGate). A manual retry key for a
FAILED read (History "TRY AGAIN") is transient UI state and stays.
Canonical synchronization never depends on it.

## Failed mutations

A failed write throws before any publish, so the UI shows the error and
keeps rendering the last valid canonical state. Regression-tested at two
levels: driver-level (statement failure, transaction rollback) and
service-level (invalid input rejects, revision unchanged).

## Testing

apps/mobile/tests/reactive-local-data.test.ts locks the architecture:

- store semantics (monotonic revision, subscribe/unsubscribe, listener
  isolation, zero domain imports);
- publish ordering over REAL SQLite (node driver): post-commit, exactly
  once per transaction, silence on failure, inert reads;
- end-to-end service mutations publish and consumers re-read fresh data
  (profile rename, bodyweight, unit/standard change, workout
  start/add/set/complete/finish, derived PR/rank rebuild, streak
  processing, schedule, notification preferences);
- the permanent UI write-ban policy and the subscription policy (every
  render-time `useRepos()` consumer subscribes to `useCanonicalRevision`;
  the hook itself must use `useSyncExternalStore`).
