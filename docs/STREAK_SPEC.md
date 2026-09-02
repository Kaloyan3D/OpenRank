# Streak Specification

**Status: Phase 6 (not yet implemented).** This document fixes the contract
the streak engine must satisfy.

## Definition

> A streak is **the number of consecutively completed required scheduled
> sessions.**

- Rest days: do not increment the streak, do not break it.
- Bonus workouts (unscheduled): do not increment the scheduled streak, do not
  break it.
- A missed scheduled session breaks the streak (the next completed session
  starts a new one).
- Paused (vacation) sessions: do not increment, do not break.
- Daily streaks are explicitly forbidden.

## Schedule ledger

Historical streaks are **never** reconstructed from the current weekly
schedule. `scheduled_sessions` is the historical ledger; the current weekly
schedule (`training_schedule_days`) only generates future rows (~35 days
ahead, reconciled on app start, schedule change, timezone change, pause,
workout completion, rescheduling).

Session statuses: `pending`, `completed`, `missed`, `paused`,
`rescheduled`. A rescheduled obligation is one session, not two: the original
becomes `rescheduled` and a new occurrence carries the new date. v0.1
restricts rescheduling to the same ISO week.

## Logical training day

The day boundary is **04:00** (`day_boundary_minutes = 240`): Tuesday 01:30
logically belongs to Monday's training day. Store both the UTC start timestamp
and the logical training date.

When a workout begins, its logical training date is matched against a pending
scheduled session; if one exists it is linked automatically. A routine mismatch
does not block completion: planned Push, trained Legs - the user still trained
(default: counts toward the streak).

## State and repair

`streak_cache` (current_streak, best_streak, perfect_weeks,
last_completed_session_id) is a cache, **not truth**.
`rebuildStreak(profileId)` must deterministically recreate the same current
streak from the ledger.

A **perfect week** = all required non-paused scheduled sessions in the week
completed. Bonus workouts do not matter.

Milestones: 5, 10, 25, 50, 100, 250, 500.

## Required test cases (Phase 6 exit)

scheduled day completed; rest day; bonus workout; missed workout; rescheduled
workout; paused vacation; schedule changed; late-night workout; 04:00
boundary; timezone change; multiple workouts same day.
