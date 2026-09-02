# Workout spec (Phase 4)

Operational contract for the workout tracker: lifecycle, snapshot semantics,
autosave, validation, tracking types, the rest timer, recovery, finish/discard
flows, dirty markers and the canonical-vs-derived split. Implementation:
`packages/database/src/services` + `apps/mobile/src/app`, `packages/domain/src/workout.ts`.

## 1. Lifecycle

States: `active` -> `completed` or deleted. At most one active workout per
profile (partial unique index; the service maps a violation to
`ActiveWorkoutConflictError`).

- **Start empty** (`startEmptyWorkout`): freestyle workout, no routine
  required. Title, notes, exercises and sets are all optional.
- **Start from routine** (`startWorkoutFromRoutine`): snapshots the routine
  (section 2) then behaves like an empty workout.
- **Resume** (`resumeActiveWorkout`): returns the active workout aggregate or
  null. The hub shows a resume card whenever one exists; a process death
  never auto-discards (task T).
- **Finish** (`finishWorkout`, section 7).
- **Discard** (`discardWorkout`, section 8).

Conflict policy: starting while a workout is active is refused with an
explicit choice - Resume / Discard & start new / Cancel. There is no silent
overwrite or silent second active workout.

## 2. Snapshot semantics

Starting from a routine copies, at start time, into the workout: exercise
order, per-exercise rest seconds, superset groups and the per-set targets
(`workout_exercises.targets_json`: set type, rep range, target weight, RPE,
RIR). From that instant the workout owns its session structure: later routine
edits (reorder, retarget, rename, archive, delete) never mutate a started or
finished workout (tested). Targets are guidance only - the UI may prefill or
hint, but logged values are always independent.

## 3. Autosave

Every meaningful mutation persists immediately through the service layer:

- Set field values commit on field end-editing (blur/enter).
- Completing a set first flushes that row's pending buffer, then completes in
  one atomic operation. Acknowledged user actions are never lost.
- Notes (workout + per-exercise) commit on blur.
- Add/remove exercise, add/delete set, reorder, superset grouping, set type:
  each is its own persisted transaction.

React state holds only in-progress input text and open/closed drawers. A
reload at any instant reproduces the screen exactly from SQLite. Duration is
never a stored counter - it is derived from `started_at` (and `finished_at`
after finish) on every tick.

## 4. Validation

Edit-time (`validateSetInput`): values may be partially empty while editing;
if present they must be finite and non-negative; reps are integers; RPE is
1-10 (fractions allowed); RIR is 0-10. No arbitrary upper limits. SQLite
CHECK constraints are the final guard (negative weight, RPE/RIR ranges).

Completion-time (`validateSetForCompletion`) requires the fields the
exercise's tracking type demands:

| Tracking type | Completion requires |
| --- | --- |
| `weight_reps` | weight (>= 0) and reps >= 1 |
| `bodyweight_reps` | reps >= 1 |
| `bodyweight_weighted` | added weight (>= 0 allowed) and reps >= 1 |
| `bodyweight_assisted` | assistance weight (>= 0) and reps >= 1 |
| `reps_only` | reps >= 1 |
| `duration` | duration > 0 s |
| `distance_duration` | distance > 0 and duration > 0 |

Violations throw `SetValidationError`; the UI surfaces the message and leaves
the row incomplete. Incomplete rows are allowed to exist and are never
silently completed or counted.

Bodyweight distinctions: reps-only bodyweight, weighted (+ kg external load)
and assisted (assistance kg) are separate tracking types. The effective
bodyweight load is never stored - ranking-core (later phase) computes it from
bodyweight entries + the external/assistance value.

## 5. Set rows and set types

Every set stores `set_type` (`normal`, `warmup`, `drop`, `failure`,
`amrap`) - compact one-letter marker in the row, tap to change. Optional
RPE/RIR live behind a per-row detail interaction (task I). Canonical units are
always kg/meters/seconds; display conversion (kg/lb, km/mi) happens in the UI
via `@openrank/shared` helpers only, with round-trip tests.

## 6. Rest timer

- One row per profile in `rest_timer`; **`ends_at` is the source of truth** -
  remaining time is derived on read (`max(0, ends_at - now)`), never a
  countdown value. Backgrounding and process death cost nothing.
- Auto-start after a completed set when the block's rest seconds > 0
  (default 90 s when unset, overridable per block in the routine builder).
- `+15 s` / ``-15 s`` / Skip are service calls that persist immediately;
  ``-15`` clamps at removing the timer when nothing remains.
- Persistence across process death (task P): on reopen, `ends_at` in the
  future resumes as a live timer; `ends_at` in the past reports
  `expired: true` with remaining 0 (tested, including the acceptance
  scenario). Expired-but-unacknowledged timers stay visible until skipped or
  replaced.
- Notifications are deferred to the notifications phase (spec permits "may").

## 7. Recovery and finish

Recovery on boot: the hub resume card shows the active workout with derived
elapsed time, exercise count and completed-set count; the rest bar reappears
if a timer is live.

Finish flow (task V):

1. Flush any pending input buffers.
2. If incomplete set rows exist, offer: **Return to workout** or **Remove N
   incomplete rows & finish** (`incompleteSetPolicy: "remove"` removes them,
   then completes). With none, a plain confirmation finishes
   (`"reject"` would surface leftovers as `IncompleteSetsError`).
3. Finish stamps `finished_at`, sets `status = 'completed'`, clears the
   profile's rest timer, and navigates to the read-only summary.

Discard flow (task W): explicit confirmation; permanently deletes the active
workout (cascading to exercises/sets) and cleans its dirty markers in the
same transaction. Routines and exercises are never deleted by a workout
discard.

## 8. Summary and history (canonical only)

`WorkoutSummary`: derived duration (`finished_at - started_at`), completed
set count, total set count, exercise count, logged volume
(`sum(weight_kg * reps)` over completed sets, kg), and per-exercise completed
sets. This is a **basic training statistic** - Phase 4 shows no PRs, ranks,
streaks or achievements anywhere. History lists completed workouts newest
first; the detail screen is read-only (immutable record, no fake edit UI) and
shows the routine origin when one existed.

## 9. Dirty markers

Phase 4 writes markers but never drains them (Phase 5's queue consumer):
- Set completed -> `workout_set` marker (`sets_changed`) + workout marker.
- Values changed on a completed set -> both markers again.
- Completed set deleted -> both markers (the deletion must invalidate
  derived state).
- Workout finished -> `workout_saved` + `workout_completed` on the workout.
- Discard/delete -> workout-level markers for the removed entities are
  cleaned up with the rows.

## 10. Logical training date

One centralized helper (`computeLogicalTrainingDate`) maps a UTC start
instant + local offset to the athlete's training day with a **04:00 local
boundary** (`LOGICAL_DAY_BOUNDARY_MINUTES = 240`): sessions started before
04:00 local belong to the previous calendar day. Boundary cases are
unit-tested; no other component may compute training dates.

## Phase 5: finish-flow integration

Finishing a workout is unchanged at the canonical layer (validate -> complete
-> clear rest timer, one transaction). On top of it the UI runs one derived
processing pass and the summary communicates honestly in all three cases:

- success: "Workout saved successfully. Updating records and ranks..." plus
  NEW PR / RANK UP sections built from the worker's events;
- worker reported errors: "Workout is safely saved. Ranks will be
  recalculated automatically." - the workout is durable regardless;
- app start: a non-blocking repair pass consumes any markers left by a crash
  or a deferred pass.

Derived state never blocks or rejects a finish (spec V).

## Phase 6: attendance integration

Finishing a workout also writes a `streak_dirty` marker inside the finish
transaction (canonical-first; the marker is repair intent, not state). The
UI then runs one streak processing pass (match -> project) next to the
Phase 5 derived pass:

- the workout satisfied a planned session: the summary shows the streak
  delta ("18 -> 19") and, when the week's obligations are all resolved and
  completed, "Perfect week completed";
- the workout was a bonus (no obligation on its logical date): a friendly
  "Bonus workout" section states that the planned-session streak remains
  unchanged;
- streak processing failed: "Workout saved successfully. Your training
  streak is being updated." - the workout stays saved and the app-start
  repair completes the projection (never a failed finish).

Starting from Home's planned session uses the day's associated routine when
one exists (context only) and an empty workout otherwise; any other valid
workout started elsewhere still satisfies the day's obligation (spec K/AT).
## Phase 7: notification integration

- Finishing a workout reconciles notifications AFTER streak processing
  (fire-and-forget): the completed session's remaining reminders cancel;
  a reconcile failure never blocks or breaks the finish (the workout is
  already durable before any notification work).
- Rest-timer notifications are driven by RestTimerService changes; the
  workout screen's +15 / -15 / skip controls need no extra wiring.
- Tapping a reminder deep-links via validated payload only: training
  reminders open Home (the user starts the session themselves - a tap
  never creates a workout); rest-timer taps open the active workout only
  if it still exists. docs/NOTIFICATIONS_SPEC.md.

## Phase 7.1: workout-layer hardening

- Canonical workout-exercise mutations (remove exercise, reorder, superset
  grouping) are WorkoutService APIs; the active workout UI routes through
  the service layer and never decides canonical persistence policy. The
  route is decomposed into features/workout components (behavior
  preserved; a source-level regression test keeps the repository calls out
  of the UI).
- Onboarding-created bodyweight is a single measurement updated in place
  (same id/measured_at) - back-navigation cannot duplicate history.
- Home: a FUTURE planned session renders as NEXT WORKOUT (VIEW PLAN +
  explicit bonus start); it can never be started as today's planned
  obligation. Manual bonus workouts remain bonus (streak untouched).
