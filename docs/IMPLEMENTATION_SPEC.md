# OpenRank — Nexus Implementation Specification

> **Authoritative project specification for Nexus**
>
> Treat this document as the source of truth for the project architecture, implementation constraints, and phase sequencing.
>
> Do **not** attempt to implement the entire specification in one run.
>
> Start with **Phase 0 — Repository Foundation** and **Phase 1 — Ranking Extraction** only.
>
> Rules:
> - Read and understand the full specification before making changes.
> - Preserve all architectural constraints.
> - Do not simplify requirements without explicitly documenting why.
> - Do not introduce features outside the specification.
> - Do not proceed to the next phase until the current phase's exit criteria are satisfied.
> - Run all relevant tests before declaring a phase complete.
> - Fix failures instead of bypassing or weakening tests.
> - Keep implementation modular and production-quality.
> - Update architecture/documentation when implementation decisions require clarification.
> - If the specification contains an ambiguity that materially affects architecture, stop and report it rather than guessing.
> - Do not ask for approval for ordinary implementation decisions already determined by the specification.
>
> **FIRST EXECUTION**
>
> Implement **Phase 0** and **Phase 1** only.
>
> Stop after both are complete and report:
> 1. What was implemented
> 2. Repository tree
> 3. Important architectural decisions
> 4. Tests added
> 5. Exact test results
> 6. Any deviations from the specification
> 7. Any discovered issues or risks
> 8. Recommended next task
>
> Do not begin Phase 2 automatically.

---

# 0. Mission

Build a completely free, open-source, local-first mobile strength-training application inspired by the strongest ideas in Liftoff, Hevy, and Hevy Ranks.

Core product promise:

> **No subscriptions. No locked ranks. No ads required. No account required. Your workouts belong to you.**

The application must remain useful with:
- zero backend
- zero account
- zero internet connection

Internet may later add optional sync/social functionality, but must never become necessary for the core application.

---

# 1. Non-negotiable product principles

Everything below must work offline:

- Exercise library
- Workout logging
- Routines
- Workout history
- Personal records
- Estimated 1RM
- Exercise ranks
- Muscle-group ranks
- Rank history
- Next-rank targets
- Bodyweight tracking
- Analytics
- Training schedule
- Streaks
- Local notifications
- Achievements
- Import/export
- Full backup/restore

## Explicitly out of scope for v0.1

Do not build yet:

- Cloud backend
- Accounts
- Login
- Social feed
- Leaderboards
- Friends
- Payments
- Subscriptions
- Nutrition
- AI coach
- Wearable apps
- Apple Health / Health Connect
- Remote push infrastructure

Architect interfaces so these can be added later without becoming dependencies of the local-first core.

---

# 2. Technology stack

Use:

```text
React Native
Expo
TypeScript strict mode
Expo Router
Expo SQLite
pnpm workspace
```

Database:

```text
expo-sqlite
SQLite
foreign keys ON
WAL mode
transactions
SQL migrations
```

Drizzle ORM may be used over Expo SQLite if it improves migrations, type safety, and query organization.

Important rule:

> **SQLite is the source of truth. React state is not the source of truth.**

React state/Zustand may only be used for temporary UI state.

---

# 3. Repository structure

Create a standalone repository. The fitness application must not live inside the Nexus repository.

```text
openrank/
│
├── apps/
│   └── mobile/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   ├── hooks/
│       │   ├── services/
│       │   ├── theme/
│       │   └── assets/
│       ├── app.config.ts
│       └── package.json
│
├── packages/
│   ├── domain/
│   ├── database/
│   ├── ranking-core/
│   ├── exercise-catalog/
│   ├── importers/
│   └── shared/
│
├── datasets/
├── scripts/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── RANKING_SPEC.md
│   ├── STREAK_SPEC.md
│   ├── DATA_SOURCES.md
│   └── PRIVACY.md
│
├── third_party/
├── THIRD_PARTY_NOTICES.md
├── CONTRIBUTING.md
├── LICENSE
├── pnpm-workspace.yaml
└── README.md
```

Important:
- `apps/mobile` must not contain core business logic.
- Ranking logic must remain in `packages/ranking-core`.
- Database access must be isolated behind repository/domain layers.

---

# 4. Layer architecture

```text
┌──────────────────────────────┐
│          Mobile UI           │
│ Expo Router / React Native   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│        Domain Services       │
│                              │
│ WorkoutService               │
│ RoutineService               │
│ RankingService               │
│ PRService                    │
│ ScheduleService              │
│ StreakService                │
│ NotificationService          │
│ AnalyticsService             │
│ BackupService                │
│ ImportService                │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│       Repository Layer       │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          SQLite DB           │
└──────────────────────────────┘
```

Ranking additionally uses:

```text
RankingService
      │
      ▼
ranking-core
      │
      ▼
Versioned Ranking Standard
```

No UI component may contain ranking formulas.

---

# 5. Exercise database

## Canonical source

Use **Free Exercise DB** as the initial canonical exercise dataset.

Expected fields:
- name
- force
- difficulty
- mechanic
- equipment
- primary muscles
- secondary muscles
- instructions
- images
- category

## Do not runtime-fetch the dataset

Create:

```text
scripts/build-exercise-catalog.ts
```

Pipeline:

```text
Pinned upstream commit
        ↓
Free Exercise DB
        ↓
validation
        ↓
normalization
        ↓
our canonical schema
        ↓
catalog.v1.json
```

Store upstream commit SHA in:

```text
datasets/sources.lock.json
```

This prevents upstream changes from silently altering app behavior.

---

# 6. Canonical Exercise model

Approximate TypeScript model:

```ts
interface Exercise {
  id: string;
  slug: string;

  name: string;

  category:
    | "strength"
    | "cardio"
    | "mobility"
    | "other";

  mechanic:
    | "compound"
    | "isolation"
    | null;

  force:
    | "push"
    | "pull"
    | "static"
    | null;

  equipment: string | null;

  trackingType:
    | "weight_reps"
    | "bodyweight_reps"
    | "bodyweight_weighted"
    | "bodyweight_assisted"
    | "reps_only"
    | "duration"
    | "distance_duration";

  isCustom: boolean;

  source: string;
  sourceId: string | null;
}
```

Muscles must be normalized into relational tables, not comma-separated fields.

Use:

```text
muscles
exercise_muscles
```

---

# 7. Exercise aliases

Create:

```text
exercise_aliases
```

Example:

```text
Bench Press (Barbell)
Barbell Bench Press
Bench Press
Développé Couché
Bankdrücken
...
       ↓
barbell_bench_press
```

This alias layer is critical for future import compatibility.

---

# 8. Media

Initial design:

```text
Exercise metadata + instructions
→ bundled

Exercise images
→ manifest + cache
```

Do not bloat the APK unnecessarily.

Core functionality must work even when exercise media is not downloaded.

Future optional feature:

```text
Download Offline Media Pack
```

---

# 9. Hevy Ranks integration

Do not turn Hevy Ranks into the application.

Extract the engine.

The existing Hevy Ranks engine already implements:

- Epley e1RM
- reps capped at 12
- bodyweight-relative strength
- exercise coefficients
- six major muscle groups
- minimum three distinct sessions
- top-three compound aggregation
- composite weights `1.0 / 0.5 / 0.25`
- isolation safeguards
- isolation-only Titan cap
- partial-data caps
- nine ranking tiers
- next-tier recommendation logic

The source is MIT-licensed. Preserve its copyright and license notice.

## Step one

Copy the original engine untouched into:

```text
packages/ranking-core/src/legacy/
```

## Step two

Create characterization tests.

Feed known workouts into the original engine and save exact expected outputs.

## Step three

Port the engine to strict TypeScript.

The refactored TypeScript implementation must produce identical output for all golden fixtures before any ranking behavior is intentionally changed.

---

# 10. Ranking engine versioning

Every ranking calculation must include:

```ts
rankingVersion: string
```

Initial compatibility identifier:

```text
hevy-ranks-compatible-v1
```

Never silently change:
- coefficients
- thresholds
- weighting
- e1RM formula
- caps
- sex multiplier behavior

Every behavior change requires a new ranking version.

Examples:

```text
openrank-strength-v1
openrank-strength-v1.1
openrank-strength-v2
```

Historical rank snapshots must store the ranking version that produced them.

---

# 11. Rank tiers

Initial tiers:

```text
Bronze
Iron
Gold
Platinum
Diamond
Titan
Colossus
Olympian
Mythic
```

Preserve original Hevy Ranks tier behavior initially.

---

# 12. Rank divisions

Add divisions without changing underlying strength thresholds:

```text
IV
III
II
I
```

Example:

```text
Diamond IV
Diamond III
Diamond II
Diamond I
```

Within a tier:

```text
0–25%   → IV
25–50%  → III
50–75%  → II
75–100% → I
```

Calculate progress from current tier threshold toward the next threshold.

Divisions are progress representation, not a new strength formula.

---

# 13. Exercise rank

OpenRank should rank individual exercises.

For a rank-eligible exercise:

```text
Best qualifying e1RM
       ↓
exercise coefficient
       ↓
reference-lift equivalent
       ↓
divide by bodyweight
       ↓
group thresholds
       ↓
Exercise Rank
```

Example:

```text
Bench Press

Diamond III
72% → Diamond II

e1RM: 123.4 kg
Bodyweight: 84.7 kg
```

---

# 14. Muscle rank

Initial groups:

```text
Legs
Chest
Back
Shoulders
Arms
Core
```

Keep Hevy Ranks top-three compound aggregation unchanged for v1.

Maintain:
- minimum session rules
- isolation safeguards
- isolation caps
- compound weighting

---

# 15. Overall Rank

Create architecture now:

```ts
interface OverallRankCalculator {
  calculate(input: OverallRankInput): OverallRankResult;
}
```

But set:

```text
overallRankEnabled = false
```

until a deliberate overall-strength calibration is designed and tested.

Do not casually average six muscle ranks.

Until then, UI should display:

```text
Strength Profile
```

instead of a potentially misleading overall rank.

---

# 16. Next-rank targets

Preserve the existing Hevy Ranks concept.

Example:

```text
Bench Press
Diamond IV → Diamond III

Current:
100 × 8

Estimated target:
102.5 × 8
```

Use reverse Epley.

Do not frame this as medical or training advice; it is only the estimated performance corresponding to the next rank threshold.

---

# 17. Database schema

## profiles

```text
id
display_name
strength_standard
unit_system
created_at
updated_at
onboarding_completed
```

`strength_standard` initially:

```text
male
female
```

Used only to select ranking thresholds.

---

## bodyweight_entries

```text
id
profile_id
measured_at
weight_kg
source
note
created_at
```

Always store kilograms internally.

---

## exercises

```text
id
slug
name
category
mechanic
force
equipment
tracking_type
is_custom
source
source_id
created_at
updated_at
```

---

## muscles

```text
id
name
major_group
```

---

## exercise_muscles

```text
exercise_id
muscle_id
role
```

Role:

```text
primary
secondary
```

---

## exercise_aliases

```text
id
exercise_id
alias
normalized_alias
locale
source
```

Index `normalized_alias`.

---

## exercise_media

```text
id
exercise_id
kind
local_path
remote_url
source
license
attribution
```

---

# 18. Routine schema

## routines

```text
id
profile_id
name
notes
created_at
updated_at
archived_at
```

## routine_exercises

```text
id
routine_id
exercise_id
position
rest_seconds
superset_group
notes
```

## routine_set_targets

```text
id
routine_exercise_id
position
set_type
target_reps_min
target_reps_max
target_weight_kg
target_rpe
target_rir
```

---

# 19. Workout schema

## workouts

```text
id
profile_id
routine_id
title

status

started_at
finished_at

start_local_date
start_timezone_offset_minutes

notes

created_at
updated_at
```

Status:

```text
active
completed
discarded
```

---

## workout_exercises

```text
id
workout_id
exercise_id
position
rest_seconds
superset_group
notes
```

---

## workout_sets

```text
id
workout_exercise_id
position

set_type

weight_kg
reps

duration_seconds
distance_meters

rpe
rir

side

completed_at
created_at
updated_at
```

Initial set types:

```text
warmup
normal
drop
failure
amrap
```

---

# 20. Workout autosave — critical requirement

A workout must never depend on pressing Finish to be saved.

Every meaningful action writes to SQLite.

Example:

```text
Complete set
    ↓
SQLite transaction
    ↓
UI updates
```

If Android kills the app immediately afterward:

```text
restart application
     ↓
Active workout found
     ↓
Resume workout
```

Acceptance test:

> Force-kill the app halfway through a workout. Relaunch it. No completed set may be lost.

---

# 21. Rest timer

Do not keep decrementing `remainingSeconds` as authoritative state.

Store:

```text
restEndsAt
```

UI derives:

```text
restEndsAt - Date.now()
```

This survives:
- backgrounding
- app switching
- pauses
- slow rendering

When a completed set triggers a rest period:

```text
set completed
      ↓
restEndsAt created
      ↓
local notification scheduled
```

---

# 22. Personal record engine

Track at least:

```text
Highest weight
Highest reps at weight
Highest e1RM
Highest single-set volume
```

Each PR must retain provenance:

```text
exercise_id
record_type
value
source_set_id
achieved_at
```

Never store only a floating PR number without linking it to the source set.

---

# 23. Derived data architecture

PRs, ranks, streak caches, and analytics are derived state.

Workout sets are canonical state.

Use a dirty-queue mechanism:

```text
derived_dirty
```

Example:

```text
set completed
     ↓
workout_set saved
     ↓
dirty exercise inserted
     ↓
transaction commit
```

Then:

```text
DerivedDataWorker
     │
     ├── PR recalculation
     ├── exercise rank
     ├── muscle rank
     ├── analytics
     └── achievements
```

If the app crashes after saving the set but before recalculating ranks, the dirty record remains and next launch repairs derived state automatically.

---

# 24. Rank snapshots

Use:

```text
rank_snapshots
```

Fields:

```text
id
profile_id

scope_type
scope_key

tier_index
tier_name
division

score
ratio
progress

ranking_version

calculated_at
source_workout_id

details_json
```

Scope:

```text
exercise
muscle
overall
```

This allows true historical rank rendering.

---

# 25. Rank events

Create:

```text
rank_events
```

Fields:

```text
id
scope_type
scope_key

from_tier
from_division

to_tier
to_division

source_workout_id
created_at
```

Example UI:

```text
AUG 17

Bench Press

Platinum I
    ↓
Diamond IV
```

---

# 26. Bodyweight resolution

Ranking requires bodyweight.

Create:

```ts
resolveBodyweight(at: Date): ResolvedBodyweight | null
```

Resolution:
1. latest entry at or before workout
2. if none exists, earliest known entry
3. if no bodyweight exists, ranking unavailable

Do not silently assume a default bodyweight.

Store the resolved bodyweight value and source entry ID in rank calculation details.

---

# 27. Training schedule

This is a core feature.

## training_schedules

```text
id
profile_id
enabled

day_boundary_minutes

reminder_style
secondary_reminder_enabled

created_at
updated_at
revision
```

Default:

```text
day_boundary_minutes = 240
```

Meaning logical day boundary = 04:00.

---

## training_schedule_days

```text
id
schedule_id

weekday
enabled

reminder_minutes_after_midnight

routine_id
```

Example:

```text
Monday     17:30
Tuesday    17:30
Thursday   18:00
```

---

# 28. Scheduled sessions

Never calculate historical streaks only from the current weekly schedule.

Create:

```text
scheduled_sessions
```

Fields:

```text
id
profile_id

original_date
scheduled_date

routine_id

status

schedule_revision

workout_id

created_at
updated_at
```

Statuses:

```text
pending
completed
missed
paused
rescheduled
```

This table is the historical streak ledger.

---

# 29. Schedule generation

Generate upcoming scheduled sessions roughly 35 days ahead.

Reconcile when:
- app starts
- schedule changes
- timezone changes
- pause added
- workout completed
- scheduled session rescheduled

Do not generate years of rows.

---

# 30. Streak definition

A streak is:

> **The number of consecutively completed required scheduled sessions.**

Example:

```text
MON ✓
TUE ✓
WED rest
THU ✓
FRI rest
SAT rest
SUN rest
MON ✓
```

Streak:

```text
4
```

Rest days:
- do not increment streak
- do not break streak

Bonus workouts:
- do not increment scheduled streak
- do not break streak

---

# 31. Missing a workout

Example:

```text
MON ✓
TUE ✓
THU ✕
MON ✓
```

Sequence:

```text
2 session streak
MISS
1 session streak
```

---

# 32. Training-day boundary

Use logical gym day boundary:

```text
04:00
```

Therefore Tuesday 01:30 may logically belong to Monday's training day.

Store:
- UTC start timestamp
- logical training date

---

# 33. Workout → scheduled session assignment

When workout begins:

```text
logical training date
       ↓
pending scheduled session?
```

If yes, link automatically.

Routine mismatch should not stop streak completion.

If user planned Push but trained Legs, they still trained.

Default:

```text
counts toward streak
```

---

# 34. Rescheduling

Allow:

```text
Monday
   ↓
Move to Wednesday
```

Original session:

```text
status = rescheduled
```

New occurrence:

```text
scheduled_date = Wednesday
```

It represents one obligation, not two.

Initially restrict rescheduling to the same ISO week.

---

# 35. Vacation / pause

Create:

```text
schedule_exceptions
```

Fields:

```text
id
profile_id

start_date
end_date

type
reason
created_at
```

Initial type:

```text
pause
```

Paused sessions:
- do not increment streak
- do not break streak

Do not allow arbitrary retroactive pause creation after a missed period in v0.1.

---

# 36. Streak state

Create:

```text
streak_cache
```

Fields:

```text
profile_id

current_streak
best_streak

perfect_weeks

last_completed_session_id
recalculated_at
```

Important:

> `streak_cache` is not truth.

Truth is:

```text
scheduled_sessions
```

Provide:

```ts
rebuildStreak(profileId)
```

The function must deterministically recreate the same current streak.

---

# 37. Perfect weeks

A perfect week means:

```text
all required non-paused scheduled sessions completed
```

Bonus workouts do not matter.

Display:

```text
🔥 Current streak: 18
🏆 Best streak: 41
📅 Perfect weeks: 6
```

---

# 38. Streak milestones

Initial milestones:

```text
5
10
25
50
100
250
500
```

Example:

```text
100 SESSION STREAK

100 consecutive planned workouts completed.
```

---

# 39. Notifications

Use local notifications only.

No backend required.

Prefer one-off future notifications over permanent weekly repeating notifications because one-off jobs are easier to reconcile with:
- vacation
- rescheduling
- schedule changes
- completed workouts
- timezone changes

---

# 40. Notification jobs

Create:

```text
notification_jobs
```

Fields:

```text
id
scheduled_session_id

kind
expo_notification_id

scheduled_for
created_at
cancelled_at
```

Kinds:

```text
primary
secondary
```

---

# 41. Primary reminder

Example:

```text
17:30

🏋️ Training day

Push Day is waiting.
Keep your 18-session streak alive.
```

Notification tap deep-links to:

```text
/workout/start?scheduledSessionId=...
```

---

# 42. Secondary reminder

Optional.

Example:

```text
20:00

🔥 Your streak is still alive

You planned to train today.
```

When workout completes:

```text
cancel secondary notification
```

Maximum:

```text
2 workout reminders / scheduled day
```

No reminders on rest days.

---

# 43. Notification personalities

User setting:

```text
Gentle
Normal
Competitive
```

Examples:

Gentle:
```text
Training is on your plan today.
```

Normal:
```text
Time to train. Keep your streak going.
```

Competitive:
```text
Diamond doesn't earn itself.
18-session streak on the line.
```

No insulting/manipulative messaging.

---

# 44. Notification permission UX

Do not immediately throw a native OS permission prompt.

First show:

```text
Never miss a planned workout

We'll remind you only on the days you choose.

[Enable reminders]
[Not now]
```

Then request OS permission.

The app remains fully functional when permission is denied.

---

# 45. Exercise screen

Target:

```text
Bench Press

[exercise media]

Chest
Barbell • Compound • Push

DIAMOND III
72% → Diamond II

Best set
102.5 kg × 6

Estimated 1RM
123.0 kg

Next rank
126.4 kg e1RM

[Progress]
[History]
[Instructions]
[Records]
```

---

# 46. Active workout screen

Target UX:

```text
Push Day                 52:14

BENCH PRESS

Previous        kg       reps

100 × 6        102.5       6   ✓
100 × 5        102.5       5   ✓
95 × 7         [   ]      [ ]

+ Add Set


INCLINE DB PRESS
...
```

Each set row must be independently persisted.

---

# 47. Home

Target:

```text
Good evening

🔥 18 session streak

THIS WEEK
M   T   W   T   F   S   S
✓   ✓   ·   ○   ·   ·   ·

○ = next workout
· = rest day


STRENGTH PROFILE

Chest       Diamond III
Back        Platinum I
Legs        Gold II
Shoulders   Platinum III
Arms        Gold I
Core        Gold IV


NEXT TARGET

Bench Press
+2.5 kg → Diamond II


[ START WORKOUT ]
```

---

# 48. Bottom navigation

Use:

```text
HOME
WORKOUT
RANKS
HISTORY
PROFILE
```

WORKOUT may be visually emphasized as the center action.

---

# 49. Expo Router structure

Approximate:

```text
src/app/
│
├── _layout.tsx
│
├── onboarding/
│   ├── index.tsx
│   ├── profile.tsx
│   ├── bodyweight.tsx
│   ├── schedule.tsx
│   └── notifications.tsx
│
├── (tabs)/
│   ├── _layout.tsx
│   ├── index.tsx
│   ├── workout.tsx
│   ├── ranks.tsx
│   ├── history.tsx
│   └── profile.tsx
│
├── workout/
│   ├── start.tsx
│   ├── active.tsx
│   └── summary.tsx
│
├── exercise/
│   └── [id].tsx
│
├── routine/
│   ├── create.tsx
│   └── [id]/
│       └── edit.tsx
│
├── rank/
│   ├── exercise/
│   │   └── [id].tsx
│   └── muscle/
│       └── [group].tsx
│
├── schedule/
│   └── index.tsx
│
├── import/
│   └── hevy.tsx
│
└── settings/
    ├── data.tsx
    ├── notifications.tsx
    └── privacy.tsx
```

---

# 50. Analytics

v0.1 should calculate locally:

## Exercise
- e1RM history
- weight history
- reps history
- rank history
- PR history

## Global
- workout count
- training duration
- sets
- total volume
- PR count
- training consistency

## Muscle volume
- Chest
- Back
- Shoulders
- Arms
- Legs
- Core

No external analytics provider required.

---

# 51. Import architecture

Common DTO:

```ts
interface ImportedWorkout {
  externalId?: string;
  source: string;

  startedAt: Date;
  finishedAt?: Date;

  name?: string;

  exercises: ImportedExercise[];
}
```

Importer implementations:

```text
HevyImporter
StrongImporter          later
FitNotesImporter        later
GenericCSVImporter      later
OpenRankBackupImporter
```

Importers must never write directly to SQLite.

Flow:

```text
file
 ↓
parser
 ↓
ImportedWorkout[]
 ↓
validation
 ↓
mapping preview
 ↓
deduplication
 ↓
ImportService
 ↓
database
```

---

# 52. Hevy import

First importer:

```text
Hevy CSV
```

Reuse useful CSV parsing logic from Hevy Ranks.

Do not require Hevy Pro or API access.

Exercise mapping:

```text
exact canonical match
 ↓
alias match
 ↓
normalized/fuzzy match
 ↓
manual mapping
```

Persist manual mappings for future imports.

---

# 53. Import deduplication

Calculate deterministic fingerprint from:

```text
source
start timestamp
exercise order
sets
```

Create:

```text
imports
```

so re-importing the same file does not duplicate history.

---

# 54. Backup

Full backup:

```text
openrank-backup.json
```

Top-level:

```ts
{
  schemaVersion: number,
  exportedAt: string,
  appVersion: string,

  profile: ...,
  bodyweight: ...,
  exercises: ...customOnly,
  routines: ...,
  workouts: ...,
  schedule: ...,
  settings: ...
}
```

Derived state does not need to be authoritative in backup.

After restore:

```text
rebuild derived state
```

This should deterministically recreate:
- PRs
- ranks
- streak cache
- analytics cache
- achievements where derivable

---

# 55. CSV export

Provide:

```text
workouts.csv
bodyweight.csv
personal-records.csv
```

No paywall.

---

# 56. Privacy

v0.1:

```text
No account
No telemetry SDK
No advertising SDK
No backend
No workout upload
```

Data page:

```text
Export my data
Backup
Restore
Delete all data
```

---

# 57. Open-source licensing

Recommended project license:

```text
AGPL-3.0-or-later
```

if the project goal is ensuring hosted/distributed derivatives remain open.

Third-party components retain original licenses.

Create:

```text
THIRD_PARTY_NOTICES.md
```

Include at least:
- Hevy Ranks — MIT
- Free Exercise DB — Unlicense/Public Domain

Perform a full dependency/license audit before first public release.

---

# 58. Derived-workout completion pipeline

When user taps Finish Workout:

```text
BEGIN TRANSACTION

mark workout completed
mark changed exercises dirty

COMMIT
```

Then:

```text
DerivedDataWorker

1. Resolve bodyweight
2. Update PRs
3. Recalculate exercise ranks
4. Recalculate affected muscle ranks
5. Write rank snapshots
6. Detect rank events
7. Resolve scheduled session
8. Rebuild streak
9. Cancel remaining reminder
10. Evaluate achievements
11. Update analytics cache
```

Then navigate to:

```text
Workout Summary
```

---

# 59. Workout summary

Example:

```text
PUSH DAY COMPLETE

57 min
18 sets
7,482 kg volume


NEW PR

Bench Press
102.5 × 6

e1RM
123.0 kg


RANK UP

Bench Press

Platinum I
     ↓
Diamond IV


🔥 STREAK

18 → 19
```

This is a key reward moment in the product.

---

# 60. Achievements

Use static definitions in code/data, not remotely configurable content.

Initial achievements:

```text
First Workout
First PR
5 Workouts
25 Workouts
100 Workouts

5 Session Streak
10 Session Streak
25 Session Streak
50 Session Streak
100 Session Streak

First Gold Rank
First Platinum Rank
First Diamond Rank
First Mythic Rank

Gold In Every Muscle Group
```

Store only unlock events.

---

# 61. Architecture for future cloud

Do not build cloud now.

Use globally unique IDs for locally owned entities.

Future:

```text
SQLite
  ↓
sync outbox
  ↓
server
```

Never:

```text
UI → server → database
```

for core training actions.

---

# 62. Testing requirements

## Ranking

Must have extensive unit tests for:
- Epley
- rep cap
- bodyweight weighted
- bodyweight assisted
- coefficients
- thresholds
- minimum sessions
- compound weighting
- isolation cap
- rank divisions
- next-tier calculation
- male/female standards
- missing bodyweight

Golden compatibility tests must ensure the TypeScript port initially matches original Hevy Ranks behavior.

## Streaks

Test:
- scheduled day completed
- rest day
- bonus workout
- missed workout
- rescheduled workout
- paused vacation
- schedule changed
- late-night workout
- 04:00 boundary
- timezone change
- multiple workouts same day

## Database

Test:
- migration from every schema version
- FK integrity
- cascade rules
- backup → wipe → restore
- derived rebuild

## Crash safety

Manual/automated scenario:

```text
start workout
complete several sets
kill app
restart
```

All completed state must survive.

---

# 63. CI

GitHub Actions must run:

```text
install
lint
typecheck
unit tests
ranking golden tests
database tests
catalog validation
license check
Android build smoke test
```

PRs cannot merge while checks fail.

---

# 64. Performance targets

Design for at least:

```text
10,000 workouts
100,000 sets
1,000 exercises
years of rank snapshots
```

without changing the data model.

Indexes should include at minimum:

```text
workouts(started_at)
workout_sets(workout_exercise_id)
bodyweight_entries(measured_at)
rank_snapshots(scope_type, scope_key, calculated_at)
scheduled_sessions(scheduled_date, status)
exercise_aliases(normalized_alias)
```

---

# 65. Phase plan Nexus must follow

## Phase 0 — Repository foundation

Build:
- pnpm workspace
- Expo app
- strict TypeScript
- Expo Router
- lint
- tests
- CI
- architecture docs
- license notices

Exit criteria:

```text
Android app launches
tests run
CI green
```

---

## Phase 1 — Ranking extraction

Build:
- original Hevy Ranks engine copy
- characterization fixtures
- golden tests
- TypeScript port
- versioned ranking configuration

Do not modify ranking behavior yet.

Exit criteria:

```text
100% golden compatibility
```

---

## Phase 2 — Exercise catalog

Build:
- Free Exercise DB importer
- canonical schema
- muscle mapping
- aliases
- catalog validation
- exercise search
- exercise details

Exit:

```text
catalog usable fully offline
```

---

## Phase 3 — Local database

Implement:
- profile
- bodyweight
- exercises
- routines
- workouts
- sets
- migrations

Exit:
- migration tests pass
- CRUD tests pass

---

## Phase 4 — Workout tracker

Build:
- routine builder
- start workout
- exercise picker
- set logger
- autosave
- rest timer
- finish workout
- history

Exit:

> User can genuinely replace a basic workout notebook with the app.

---

## Phase 5 — PR + ranks

Build:
- DerivedDataWorker
- PR engine
- exercise ranks
- muscle ranks
- next-rank targets
- rank history
- rank-up events

Exit:

> Finishing a workout deterministically updates ranks.

---

## Phase 6 — Scheduled streaks

Build:
- weekly training schedule
- scheduled session ledger
- logical training day
- 04:00 boundary
- streak calculator
- perfect weeks
- reschedule
- vacation pause
- milestones

Exit:

```text
all streak edge-case tests pass
```

---

## Phase 7 — Notifications

Build:
- permission UX
- primary reminder
- secondary reminder
- notification reconciliation
- deep links
- rest timer notifications

---

## Phase 8 — Analytics + polish

Build:
- charts
- bodyweight history
- e1RM history
- strength profile
- rank timeline
- animations
- workout summaries
- achievements

---

## Phase 9 — Data ownership

Build:
- Hevy CSV import
- JSON backup
- restore
- CSV export
- delete all data
- privacy screen

---

# 66. Definition of Done — first usable release

A brand-new user can:

```text
Install APK
   ↓
Open app with no account
   ↓
Choose kg/lb
   ↓
Enter bodyweight
   ↓
Choose training days
   ↓
Optionally enable notifications
   ↓
Browse exercises offline
   ↓
Create routine
   ↓
Start workout
   ↓
Log sets
   ↓
Kill and reopen app without losing workout
   ↓
Finish workout
   ↓
See PRs
   ↓
See exercise ranks
   ↓
See muscle ranks
   ↓
See next-rank target
   ↓
Increase scheduled streak
   ↓
See workout history
   ↓
Export full backup
```

All of this must work in:

```text
AIRPLANE MODE
```

after installation.

---

# 67. Hard implementation rules for Nexus

Nexus must not:

1. Introduce a backend to solve a local problem.
2. Add authentication.
3. Rewrite ranking formulas without characterization tests.
4. Calculate ranks inside UI components.
5. Store pounds internally.
6. Treat derived ranks as canonical data.
7. Depend on Hevy API for normal operation.
8. Depend on GitHub/network for the exercise catalog at runtime.
9. Lose workouts when the process dies.
10. Use current weekly schedule to reconstruct historical streaks.
11. Use daily streaks.
12. Count rest days as missed days.
13. Count bonus workouts toward scheduled streaks.
14. Lock any rank behind a subscription.
15. Add analytics/tracking SDKs without an explicit future decision.
16. Start Phase 2 before Phase 0 and 1 exit criteria are complete.

---

# 68. First exact Nexus task

```text
TASK: OpenRank Repository Foundation + Ranking Core

1. Create a new pnpm monorepo.
2. Create apps/mobile using Expo + TypeScript + Expo Router.
3. Enable strict TypeScript.
4. Create packages:
   - domain
   - database
   - ranking-core
   - exercise-catalog
   - importers
   - shared

5. Add Vitest infrastructure for pure TypeScript packages.

6. Import the current BenjiPy/hevy-ranks engine into:
   packages/ranking-core/src/legacy/

7. Preserve its MIT license notice.

8. Build characterization fixtures covering:
   - all 9 ranks
   - all 6 muscle groups
   - compound aggregation
   - isolation fallback
   - assisted bodyweight
   - weighted bodyweight
   - minimum session behavior
   - male/female thresholds
   - next-tier recommendation

9. Create a strict TypeScript port without intentionally changing behavior.

10. Require exact golden compatibility.

11. Create:
   docs/ARCHITECTURE.md
   docs/RANKING_SPEC.md
   docs/DATABASE.md
   docs/STREAK_SPEC.md

12. Do not proceed to new ranking features until the compatibility harness is green.

Deliver:
- repository tree
- architecture notes
- all tests
- exact test results
- any deviations from this specification
- discovered issues/risks
- next implementation task recommendation
```

---

# 69. Final architecture principle

If only one architectural rule is preserved, it must be this:

```text
             USER DATA
                │
                ▼
             SQLite
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
   Workout     Rank     Streak
    Engine    Engine     Engine
      │         │         │
      └─────────┼─────────┘
                ▼
               UI
```

Never:

```text
UI → random state → formulas → APIs → maybe DB
```

Ranks, streaks, PRs, and analytics must remain deterministic projections over canonical workout data.

If a cache breaks, rebuild it.
If the app crashes, workout data survives.
If no server ever exists, the product still works.

---

# 70. Product identity

The project should remain:

> **Free forever. Open source. Offline-first. No subscriptions. Your workout data stays yours.**

Core differentiators:
- transparent strength-ranking algorithm
- scheduled-session streaks instead of unhealthy daily streaks
- rest days never break streaks
- optional local reminders only on chosen training days
- no account required
- no paywalled ranks
- full data ownership
- complete offline functionality
