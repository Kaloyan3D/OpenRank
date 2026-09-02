# Database Specification

**Status: Phase 3 (not yet implemented).** This document fixes the contract
Phase 3 must implement. `packages/database` currently contains no schema.

## Engine requirements

- `expo-sqlite`, SQLite
- **foreign keys ON** (every connection)
- **WAL mode**
- explicit **transactions** for every multi-step write
- **SQL migrations**, versioned; migrations must be testable from every schema version

**SQLite is the source of truth. React state is not.**

Kilograms are the internal storage unit for all masses - never store pounds.

## Planned schema (v1)

### Identity and bodyweight

- `profiles`: id, display_name, strength_standard (`male` | `female` - used
  only to select ranking thresholds), unit_system, created_at, updated_at,
  onboarding_completed
- `bodyweight_entries`: id, profile_id, measured_at, weight_kg, source, note, created_at

### Exercises

- `exercises`: id, slug, name, category, mechanic, force, equipment,
  tracking_type, is_custom, source, source_id, created_at, updated_at
- `muscles`: id, name, major_group
- `exercise_muscles`: exercise_id, muscle_id, role (`primary` | `secondary`)

Muscles are normalized into relational tables - never comma-separated fields.

- `exercise_aliases`: id, exercise_id, alias, normalized_alias, locale, source
  (indexed on `normalized_alias`) - critical for future import compatibility
- `exercise_media`: id, exercise_id, kind, local_path, remote_url, source,
  license, attribution (bundled metadata + cached images; core features must
  work without downloaded media)

### Routines

- `routines`: id, profile_id, name, notes, created_at, updated_at, archived_at
- `routine_exercises`: id, routine_id, exercise_id, position, rest_seconds,
  superset_group, notes
- `routine_set_targets`: id, routine_exercise_id, position, set_type,
  target_reps_min, target_reps_max, target_weight_kg, target_rpe, target_rir

### Workouts

- `workouts`: id, profile_id, routine_id, title, status (`active` |
  `completed` | `discarded`), started_at, finished_at, start_local_date,
  start_timezone_offset_minutes, notes, created_at, updated_at
- `workout_exercises`: id, workout_id, exercise_id, position, rest_seconds,
  superset_group, notes
- `workout_sets`: id, workout_exercise_id, position, set_type (`warmup` |
  `normal` | `drop` | `failure` | `amrap`), weight_kg, reps,
  duration_seconds, distance_meters, rpe, rir, side, completed_at, created_at,
  updated_at

### Ranks (derived)

- `rank_snapshots`: id, profile_id, scope_type (`exercise` | `muscle` |
  `overall`), scope_key, tier_index, tier_name, division, score, ratio,
  progress, ranking_version, calculated_at, source_workout_id, details_json
- `rank_events`: id, scope_type, scope_key, from_tier, from_division, to_tier,
  to_division, source_workout_id, created_at

### Schedule and streaks

- `training_schedules`: id, profile_id, enabled, day_boundary_minutes
  (default 240 = 04:00), reminder_style, secondary_reminder_enabled,
  created_at, updated_at, revision
- `training_schedule_days`: id, schedule_id, weekday, enabled,
  reminder_minutes_after_midnight, routine_id
- `scheduled_sessions`: id, profile_id, original_date, scheduled_date,
  routine_id, status (`pending` | `completed` | `missed` | `paused` |
  `rescheduled`), schedule_revision, workout_id, created_at, updated_at
  (historical streak ledger)
- `schedule_exceptions`: id, profile_id, start_date, end_date, type
  (`pause`), reason, created_at
- `streak_cache`: profile_id, current_streak, best_streak, perfect_weeks,
  last_completed_session_id, recalculated_at (**cache, not truth** - truth is
  `scheduled_sessions`; `rebuildStreak(profileId)` must recreate it
  deterministically)

### Notifications and imports

- `notification_jobs`: id, scheduled_session_id, kind (`primary` |
  `secondary`), expo_notification_id, scheduled_for, created_at, cancelled_at
- `imports`: id, source, fingerprint, imported_at, ... (deduplication ledger;
  re-importing the same file must not duplicate history)

## Required indexes

Performance targets: 10,000 workouts / 100,000 sets / 1,000 exercises / years
of rank snapshots - without changing the data model.

```text
workouts(started_at)
workout_sets(workout_exercise_id)
bodyweight_entries(measured_at)
rank_snapshots(scope_type, scope_key, calculated_at)
scheduled_sessions(scheduled_date, status)
exercise_aliases(normalized_alias)
```

## Derived data policy

PRs, ranks, streak caches, and analytics are **derived state**; workout sets
are canonical state. Writes follow the dirty-queue pattern:

```text
set completed -> workout_set saved -> derived_dirty insert -> commit
DerivedDataWorker: PRs -> exercise rank -> muscle rank -> analytics -> achievements
```

PR provenance is mandatory: every PR row links `exercise_id`, `record_type`,
`value`, `source_set_id`, `achieved_at`. No floating PR numbers.

## Crash-safety acceptance test

> Start a workout, complete several sets, force-kill the app, relaunch.
> Every completed set must still be there; the active workout resumes.
