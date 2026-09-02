# Streak Specification

**Status: implemented (Phase 6).** This document fixes the contract of the
scheduled-training streak system and documents the shipped behavior.

## Definition

> A streak is **the number of consecutively completed required scheduled
> sessions.**

- Rest days: do not increment the streak, do not break it.
- Bonus workouts (unscheduled): do not increment the scheduled streak, do not
  break it. They stay normal workout history and can set PRs/ranks.
- A missed scheduled session breaks the streak (the next completed session
  starts a new one).
- Paused (vacation) sessions: do not increment, do not break.
- Rescheduled source occurrences: neutral (the moved target is the one
  obligation).
- **Daily streaks are explicitly forbidden.** The product line is:
  "Rest days don't break your streak. Missing your plan does."

Strength and attendance are separate systems (spec B): the streak engine
never touches rank/PR code, and rank/PR behavior never depends on training
frequency. A regression test asserts streak processing leaves workouts, sets,
PR rows, rank snapshots and rank events byte-identical (spec BD).

## Data model (schema v4)

| table | role |
| --- | --- |
| `training_schedules` | one per profile; `enabled`, `day_boundary_minutes` (default 240), `revision` |
| `training_schedule_days` | ISO weekday 1=Mon..7=Sun, `enabled`, optional routine context; UNIQUE(schedule, weekday) |
| `scheduled_sessions` | the materialized obligation ledger - the ONLY historical truth |
| `schedule_exceptions` | planned pauses (start/end/reason-informative) |
| `streak_cache` | current/best streak, perfect weeks, last completed session (projection) |
| `streak_events` | milestone/broken events with stable identity |
| `streak_dirty` | dedicated repair queue (spec S option B) |

### Scheduled session ledger

Fields: `original_date` (never changes), `scheduled_date` (effective
obligation date), `routine_id` (context only), `status`,
`schedule_revision` (revision the obligation was generated from),
`workout_id` + `completed_at` (link when satisfied),
`rescheduled_from_date` (provenance on targets), `streak_after` (read
model). Statuses: `pending`, `completed`, `missed`, `paused`,
`rescheduled`, `cancelled`.

A partial UNIQUE index guarantees at most one ACTIVE
(pending/completed/missed/paused) session per (profile, date): one training
day holds exactly one obligation; cancelled/rescheduled rows are inert
history and may coexist with a new active row.

The current weekly configuration is NOT historical truth: every session
records the schedule revision it came from, and history is never rebuilt
from today's settings (spec F/AP).

## Logical training day

One shared implementation (Phase 4 `computeLogicalTrainingDate`): the
boundary is 04:00 local (`day_boundary_minutes = 240`). Monday 23:30 ->
Monday; Tuesday 01:30 -> logically Monday; 03:59/04:00/04:01 boundary tests
exist. All other date math is calendar-date arithmetic (YYYY-MM-DD strings,
UTC-midnight) - no "24 hours since the previous obligation" anywhere, so
DST never moves a Monday (spec AN).

## Schedule revisioning

Every meaningful weekly change (day added/removed, routine association
changed) bumps `training_schedules.revision`; no-op updates do not. New
obligations are stamped with the generating revision. Changing the schedule:
- pending obligations from today's logical day onward are reconciled to the
  new explicit schedule (spec I);
- rescheduled targets are user intent and survive schedule edits;
- completed/missed/paused/rescheduled history is immutable (spec AP).

## Generation (spec H)

`reconcileUpcomingSessions(profileId, {todayUtc, timezoneOffsetMinutes})`
materializes a rolling **35-day horizon** of pending sessions (INSERT OR
IGNORE under the unique index: idempotent, deterministic). Run on app start,
after onboarding, on schedule change, pause add/remove, reschedule, and
workout completion. It never pre-generates years of rows.

Resolution order inside a processing pass (deliberate, spec Y/BB):
1. **generate** the horizon from the current revision;
2. **pause overlay**: pending sessions inside any pause range become
   `paused` - an unfinalized (never-resolved) session during a vacation is
   paused, not missed, even if processing ran late;
3. **match** completed workouts to pending obligations;
4. **expire**: pending sessions whose logical day definitively passed become
   `missed` (Monday is not missed until Tuesday 04:00 local);
5. **project** the streak and clear satisfied markers.

Finalized (`missed`) sessions are immutable: a pause created afterwards can
never resurrect them - **no retroactive streak freeze** (spec Y is a hard
rule; there is no freeze token/currency/rescue mechanic and none may be
added via pauses).

## Workout matching (spec K/L)

A completed workout's logical training date (stored with the workout) is
matched against the FIRST pending session on that date; the session is linked
(`workout_id`, `completed_at`) and completed. The planned routine does not
matter (planned Push, trained Legs - the user trained). One obligation is
satisfied exactly once; the second workout that day is a **bonus workout**
(unlinked, streak unchanged, never shamed in UI).

## Rescheduling (spec U/V)

Only pending future/current sessions move, only within the same ISO week,
target must be free (no active session) - otherwise a structured
`RescheduleError` is raised. The source becomes `rescheduled` and the new
row carries `original_date` + `rescheduled_from_date`: ONE obligation,
wherever it lands. Moving completed/missed sessions or into the past is
rejected. Repeating a move on the same source is rejected (it is no longer
pending); re-moving the current target is allowed.

## Pauses (spec W/X)

`schedule_exceptions` rows (type `pause`) with start/end dates and an
optional informational reason. Paused sessions are neutral. Overlapping
pauses are rejected (deterministic policy). Removing a pause is allowed only
while it has not fully elapsed; paused sessions from today's logical day
onward return to pending (fully elapsed pauses are history).

## Disabling the schedule (spec AH/AI)

Disabling creates NO misses: pending today/future obligations become
`cancelled` (an explicit non-historical state, not an abused `paused`);
past-due pending also cancels (windows passed while disabled). History, best
streak and current streak are preserved; re-enabling regenerates the horizon
from the current configuration/revision.

## Streak calculation (spec O/P)

Pure `computeStreakState(sessions)` over the chronological ledger:
completed -> +1 (milestones at stable crossings), missed -> reset 0 (+broken
event), pending -> stops current-streak evaluation (never a miss),
paused/rescheduled/cancelled -> neutral. Best streak persists independently.
Spec P example: MON/TUE/THU + MON completed, TUE missed, THU completed ->
current 1, best 4.

### Perfect weeks (spec Z/AA)

An ISO week (Monday-start, ISO-8601 year/week key) is perfect iff it had at
least one required non-paused obligation and ALL of them are completed. A
week with zero obligations is never perfect; a week with pending obligations
is not final yet; a pause inside a completed week keeps it perfect. Weeks
crossing month/ISO-year boundaries key correctly.

### Milestones (spec AB/AC)

5, 10, 25, 50, 100, 250, 500. Events carry stable identity
(`milestone:<n>`, `broken:<sessionId>` under UNIQUE(profile, type, key)):
rebuilds and retries can never re-celebrate. Broken events use neutral copy.

## Architecture (spec R/S/T)

- **Canonical-first**: `finishWorkout` commits the workout and marks
  `streak_dirty` (workout_completed) INSIDE the same transaction. Streak
  processing failing can never roll back or fail the finish.
- **Dedicated queue (option B)**: a small `streak_dirty` table with
  explicitly typed reasons; cleaner than overloading the strength dirty
  queue with a second consumer's semantics. Restart-safe, retry-safe,
  coalescing (UNIQUE per entity+reason), cleared only after projection
  succeeds, in the same transaction as the writes.
- **`StreakService.processPending`**: one transaction per profile -
  materialize -> match -> expire -> project -> clear. Failures keep markers
  and are reported; the app-start repair and the finish flow retry.
- **`rebuildAllStreakState(profileId)`** is projection-only (never mutates
  ledger statuses): incremental and rebuild run the same pure function,
  which is what makes them equal; parity tests compare cache, events,
  per-session streak marks and linked workouts.

## Timezone behavior (spec AM)

Canonical timestamps are UTC; scheduled dates are local-calendar concepts.
v1 policy: historical resolved sessions keep their stored local scheduled
date; a completed workout matches using the logical local date captured at
start (the workout's own offset); future pending sessions were generated
under the offset at reconcile time and may be reconciled forward - travel
never silently rewrites resolved history (tested).

## Failure recovery (spec AU)

If streak processing fails after a finish, the summary says "Workout saved
successfully. Your training streak is being updated." and the app-start
repair completes the work. The ledger + dirty markers make every step
idempotent.

## Not implemented (by scope)

Reminder/notification anything (Phase 7), Streak Freeze tokens/purchasable
freezes (forbidden product-wise), achievements beyond streak milestones,
social/leaderboards/cloud.
