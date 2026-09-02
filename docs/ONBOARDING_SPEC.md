# Onboarding spec (Phase 7.1)

OpenRank's first complete user journey: fresh installation -> local profile
creation -> units -> ranking reference -> optional bodyweight -> training
schedule -> optional Phase 7 reminders -> Home -> workout/rank/streak
ecosystem.

## 1. Product principle: no account

This is NOT authentication. There is no login, signup, email, password,
OAuth or backend identity - OpenRank is fully usable without an account.
The profile created here is a LOCAL DOMAIN PROFILE stored in SQLite. A
future remote account must BIND to the local profile, never replace it;
logging out of any future account must never imply deleting local workout
history.

```
LocalProfile (SQLite, v1: exactly one)
    |
    +---- optional future account binding
                |
                v
          Remote Account
```

## 2. Onboarding state model (schema v6)

- `profiles.onboarding_step` (TEXT, nullable) - the durable current step.
  The resume route derives from this column, never from React state.
  NULL before the flow starts and after completion.
- `profiles.onboarding_completed` (INTEGER 0/1, existed since v1) - REAL
  routing semantics: false keeps the app inside onboarding; true unlocks
  the main tabs. Only the Ready screen's explicit START OPENRANK action
  sets it (via ProfileService.completeOnboarding, idempotent, clears the
  step pointer).

Step ladder (fixed, validated by ProfileService):
welcome -> profile_name -> units -> strength_standard -> bodyweight ->
training_days -> plan_review -> reminders -> ready.

Every meaningful step persists BEFORE routing onward, so a process death
at any point resumes from the database: profile name (creates the profile
row), units, ranking reference, bodyweight (or skip), schedule, reminder
choice. Restart never creates a second profile and never discards choices.

## 3. Existing-profile compatibility migration

Migration `schema_v6_onboarding_state` adds the step column AND executes
`UPDATE profiles SET onboarding_completed = 1 WHERE onboarding_completed =
0`. Deterministic schema semantics (no timestamps, no device-clock
heuristics): every profile that exists in a v1-v5 database predates the
first-launch flow entirely - that app version's screens assumed a usable
profile - so it is marked completed and never sees onboarding. A fresh
installation has NO profile row and therefore requires onboarding.
Regression-tested by rebuilding a real v5-shaped database and migrating.

## 4. Single local profile v1

ProfileService.createLocalProfile documents three deterministic outcomes:

- no profile -> create (status "created")
- incomplete profile exists -> resume/reuse it (status "reused"); the
  display name and step are refreshed, nothing duplicated
- completed profile exists -> structured conflict (status "conflict")
  carrying the existing profile; callers route to the main app

Profile creation never silently generates multiple default profiles; the
profiles table stays a single row per device. Multi-profile is not built,
but nothing in the schema or service prevents a future extension.

## 5. Root application routing gate

The root layout mounts RoutingGate above the navigator (after SQLite
open -> migrate -> seed -> service init). The decision is the exported
pure helper resolveRootRoute(profile):

- no profile -> /onboarding
- profile, onboarding_completed = false -> /onboarding/resume
- profile, onboarding_completed = true -> main app renders

Normal screens may therefore ASSUME a valid completed profile; the dead-end
"Finish onboarding..." placeholder states are gone. If the tabs somehow
render without a profile (corruption), screens show a recoverable
internal-state error - nothing silently creates a replacement profile.

### Deep links before onboarding (spec 8)

Direct destinations (/workout/..., /schedule, /ranks, /exercise/...,
/muscle/..., /history/..., notification payloads) are covered by the same
gate: while onboarding is incomplete the destination is never rendered.
v1 policy: the requested destination is NOT replayed after completion -
after onboarding the app opens Home. Receiving a deep link never creates a
workout and never mutates canonical state on its own.

## 6. Step semantics

- Welcome: honest copy (free, open source, no account, data stays on the
  device). No cloud/sync/server claims.
- Local profile: trimmed, non-empty, max 40 Unicode code points display
  name; stored verbatim otherwise (no case folding, no normalization) -
  display text is user identity, not a key.
- Units: display-only choice (metric kg/km, imperial lb/mi). Canonical
  storage stays kg / meters / seconds / UTC; ranking math unaffected.
- Ranking reference: male / female reference standard - the only options
  the frozen calibrated engine supports. Positioned explicitly as a
  ranking threshold selector, not identity.
- Bodyweight: required for ranks, skippable. SKIP stores NOTHING fake (no
  70 kg default, no estimate; rank UI stays unavailable). Entering a value
  persists immediately through ProfileService.setOnboardingBodyweight,
  which UPDATES the single onboarding-sourced measurement in place (same
  id, same measured_at) - back-navigation can never create accidental
  duplicate history rows (permanently tested).
- Training days: reuses ScheduleService exclusively (setScheduleEnabled +
  updateWeeklySchedule over all 7 weekdays). ZERO selected days is valid
  onboarding; no routine assignment is required.
- Plan review: shows MON . TUE . THU ("Rest days don't break your
  streak.") or "No scheduled training days yet." for zero days.
- Reminders: reuses the Phase 7 stack only - NotificationService
  preferences, per-day reminder times (minutes after local midnight,
  shared 04:00 logical-day behavior), pre-permission explainer, then the
  optional OS permission request. A visible default time (17:30) is
  suggested; applying it requires the explicit Enable press. Permission
  denial NEVER blocks onboarding. With zero training days the screen does
  not request training-reminder permission; it explains that reminders
  become available after a schedule is configured.
- Ready: summary (profile, training days, ranks ready / add bodyweight
  later, reminders enabled / off). START OPENRANK is the only completion
  transition, then router.replace("/(tabs)").

## 7. Home future-session semantics (spec 24)

The exported pure helper resolveHomeSessionView decides the next-action
card deterministically:

- TODAY's pending planned session -> TODAY - TRAINING DAY with
  START WORKOUT.
- TODAY completed / missed -> reported honestly; only an explicit
  START BONUS WORKOUT is offered.
- Next obligation in the FUTURE -> NEXT WORKOUT card with VIEW PLAN and
  an explicit, separately labeled START BONUS WORKOUT. The CTA cannot
  imply that starting today satisfies the future obligation - satisfying
  it requires an explicit ScheduleService.rescheduleSession to today.
  Early planned training is never silently reinterpreted.
- Manual workouts on any day remain BONUS workouts; the streak counts
  planned sessions only (Phase 6 semantics untouched).

## 8. Related hardening in Phase 7.1

- Home week strip is compact (letter + state glyph + today marker) while
  every cell keeps a full textual accessibility label (Completed /
  Planned / Rest day / Missed / Paused / Rescheduled) - never color alone.
- Schedule routine picker exposes EVERY active routine via a modal list
  (the old slice(0, 3) limitation is gone).
- Planned pauses use an explicit validated From/To date range (service
  still enforces overlap rejection and Phase 6 streak neutrality).
- Active-workout canonical mutations (remove exercise / reorder /
  superset grouping) go through WorkoutService; the active workout route
  is decomposed into features/workout components with unchanged behavior.
- Android CI smoke builds a REAL debug APK: expo prebuild --platform
  android --no-install in apps/mobile, then ./gradlew assembleDebug from
  apps/mobile/android. expo export is not a substitute.
- Vendored upstream data is pinned byte-exact via .gitattributes (-text)
  so raw-byte integrity hashes pass on every platform regardless of
  core.autocrlf (spec 32 / docs/DATABASE.md).
