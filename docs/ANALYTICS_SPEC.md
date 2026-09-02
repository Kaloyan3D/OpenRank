# Analytics spec (Phase 8)

OpenRank's analytics are DETERMINISTIC PROJECTIONS over canonical workout
data (architecture principle 69). They answer "how is my training going?"
from the same SQLite source of truth as ranks and streaks - recalculated on
read, rebuildable, never canonical, never uploaded.

## 1. Non-negotiables

- NO tracking/telemetry SDKs. "Analytics" here means product data views,
  not behavioral data collection (hard rule 67.15). Nothing leaves the
  device.
- No rank math outside the derived engines. Analytics services read
  repository projections (personal records, rank snapshots, bodyweight,
  completed workouts) and reshape them for charts - they never re-derive a
  rank or an e1RM.
- Nothing in analytics writes. Every read is side-effect free; running the
  projection twice yields the identical view (regression-tested).
- Charts render points; they never compute. The UI consumes point lists
  from AnalyticsService verbatim.

## 2. AnalyticsService (packages/database)

Read models (all pure projections, all tested):

- `bodyweightSeries(profileId)` - chronological bodyweight measurements
  (repository history reversed to ascending).
- `e1rmProgression(profileId, exerciseId)` - the max_e1RM personal-record
  event stream, ascending. Each point is a NEW verified best, so the series
  is the honest best-progression step function; non-PR sessions add no
  point and no value is ever estimated.
- `rankTimeline(profileId, scopeType, scopeKey)` - rank snapshots
  (calculatedAt, score, tier, division) in chronological order.
- `weeklyActivity(profileId, weeks)` - ISO-week buckets of completed
  workouts with canonical set counts and logged volume. Buckets are keyed
  by the ISO week of each workout's canonical start instant; the window
  ends at the current ISO week. Incomplete sets contribute nothing.
- `workoutVolumeBreakdown(workoutId)` - completed-volume per exercise for
  one workout (summary bar chart), in logged order.
- `strengthProfileSummary(profileId)` - latest muscle-group rank per group
  plus history depth (snapshot counts).

## 3. Achievements (packages/database)

- `ACHIEVEMENT_DEFINITIONS` - the v1 catalog: honest milestone achievements
  only (first workout, session counts, cumulative volume, record counts,
  scheduled-streak milestones, first rank, full profile, bodyweight
  logged). No daily-streak mechanics, no streak-shaming, no paywalled
  ranks, no social comparison.
- `evaluateAchievements(stats)` - PURE evaluation: unlock = current >=
  target, progress = clamp(current/target, 0, 1). No clocks, no writes.
- `AchievementService.list(profileId)` - collects stats once per read
  (completed workouts, cumulative completed volume, standing personal
  records, best scheduled streak, ranked muscle groups, bodyweight entries)
  and evaluates the catalog. Achievements are stored nowhere; a rebuilt
  cache reproduces them exactly.

## 4. Charts module (apps/mobile)

Pure React Native views - no chart library, no SVG, no new native
dependency (the native graph stays untouched):

- `BarChart` - deterministic bars scaled to the series max, animated
  draw-in, full textual accessibility labels (never color alone).
- `TierTimeline` - rank-score timeline bars colored by tier band, with
  rank labels per bar.
- `AnimatedProgress` / `PressableScale` - shared polish primitives
  (animated 0..1 fills, press feedback).

## 5. Surfaces

- `/progress` - analytics hub: weekly activity, bodyweight history,
  strength-profile overview with per-group timelines, achievements link.
- `/achievements` - the milestone catalog with progress bars.
- Exercise detail - e1RM progression chart next to records/PR history.
- Muscle group detail - rank timeline chart next to the ledger.
- Workout summary - NEW PR / RANK UP / STREAK / BONUS cards (existing) plus
  the per-exercise volume chart.
- Profile tab - recent bodyweight chart, achievements summary, entry points
  to the hub.
