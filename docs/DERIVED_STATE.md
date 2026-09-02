# Derived State (Phase 5)

Personal records, exercise ranks, muscle ranks, rank snapshots and rank
events are **rebuildable caches** over canonical workout data. They are never
source data: deleting every derived row and running
`rebuildAll(profileId)` reproduces them exactly from `workouts` /
`workout_sets` / `bodyweight_entries` / `exercises`. Canonical history is
read-only for the derivation worker.

Engine: **`hevy-ranks-compatible-v1`** (frozen, `packages/ranking-core`).
Everything OpenRank adds around it is versioned separately as
**`openrank-ranking-projection-v1`** (eligibility gating, provisional policy,
divisions, snapshot/event persistence).

## Schema v3 tables

| table | key | meaning |
| --- | --- | --- |
| `personal_records` | UNIQUE(profile, exercise, record_type, qualifier_key) | current best per record key |
| `personal_record_events` | UNIQUE(profile, exercise, record_type, qualifier_key, source_set_id) | immutable unlock history |
| `rank_snapshots` | UNIQUE(profile, scope, source_workout_id) | rank state after each producing workout |
| `rank_events` | UNIQUE(profile, scope, source_workout_id) | tier transitions (up AND down) |
| `derived_dirty` | (Phase 3) | work queue consumed by the worker |

Provenance columns (`source_set_id`, `source_workout_id`) are plain TEXT
without foreign keys: canonical deletions never cascade into projections;
a rebuild restores consistency instead.

`exercise_aliases.source_id` (Hevy template id) was added in v3 - the
RankingInputBuilder needs it to synthesize the engine catalog deterministically.

## Personal records

One authoritative e1RM implementation exists (ranking-core Epley, reps
capped at 12); the PR layer reuses `estimate1RM` / `effectiveLoad` and
recreates no math.

| tracking type | max_weight | max_e1rm | max_set_volume | max_reps_at_weight |
| --- | --- | --- | --- | --- |
| weight_reps | external kg | yes | external kg x reps | per external kg |
| bodyweight_weighted | ADDED kg (documented) | effective (bw + added; needs bodyweight) | added kg x reps (documented) | per added kg |
| bodyweight_assisted | excluded (assistance is regression) | effective (bw - assistance; needs bodyweight) | excluded | per assistance level |
| bodyweight_reps / reps_only | excluded | excluded | excluded | `w=0` |
| duration / distance_duration | excluded | excluded | excluded | excluded (no PRs in Phase 5) |

Semantics:

- **Strictly-greater only.** An equal repeat is never a PR; float noise
  (1e-9 relative) never is either.
- **Weight qualifier normalization**: canonical kg rounded to 4 decimals,
  shortest JS number rendering, `w=` prefix; pure bodyweight is `w=0`.
  Unit-conversion noise cannot split one weight in two (see
  `qualifier.ts`).
- Warmup, incomplete and invalid sets never produce records.
- Without bodyweight: absolute records still work; bodyweight-normalized
  e1RM records do not exist until a bodyweight entry covers the workout
  (no fabricated normalization - the engine's bw-as-0 fallback is a ranking
  quirk, deliberately not a PR semantic).
- Changing bodyweight history legitimately changes historical e1RM records;
  the rebuild recomputes them from canonical data.

## Eligibility semantics

- **eligible**: full ranking participation (both passes below).
- **provisional**: appears in the exercise-rank pass with an explicit
  PROVISIONAL label; **never contributes to muscle composites in v1**
  (documented projection policy).
- **unsupported**: no rank, ever; honest messaging in the UI; full PR support.

## Ranking pipeline

Per processed workout `W` (chronological, one shared step function for both
paths):

1. `RankingInputBuilder` (pure, deterministic) converts completed workouts
   into engine sessions (completed, non-warmup sets; stable ordering;
   per-workout bodyweight resolution; eligibility filtering) and synthesizes
   engine catalog templates from the stored Phase 2 classification
   (engine group, equipment, tracking type, Hevy template id).
2. Two `computeRanks` passes:
   - **exercise pass** (eligible + provisional) - per-exercise tier =
     `ratioToTierIndex(ownLift.eqRatio, groupThresholds, sexFactor)`;
     isolation lifts capped at Titan (projection-level interpretation of the
     engine's isolation cap);
   - **muscle pass** (eligible only) - engine group results unchanged
     (composite top-3 [1.0, 0.5, 0.25], compound preference, isolation
     fallback capped Titan, few-session cap Platinum).
3. **Snapshots** are written only when the state changes (tier + division +
   score within float tolerance). Division-only changes update the snapshot
   without an event.
4. **Events** are written only on tier changes and only when a previous
   state existed (first appearance = snapshot, not event). Both directions
   are recorded (bodyweight/standard changes can lower ranks).

### Divisions (application-level representation)

Within-tier progress `p`: `IV < 0.25 <= III < 0.5 <= II < 0.75 <= I`.
Progress is quantized to 9 decimals so binary float noise cannot flip an
exact boundary. **Mythic** (top tier): `division = NULL`, `progress = NULL`,
UI shows "MYTHIC". Divisions never alter strength math.

### Next-rank targets

Exercise scope: reverse Epley via the engine's `weightForReps` -
"next tier needs ~X kg of 1RM on this lift's reference; e.g. Y kg x N reps".
This is an **estimate corresponding to the ranking threshold**, never a
prescription. Muscle scope: the engine's `nextTierRecommendation` is stored
in the snapshot's `details_json`.

## Worker

`DerivedDataWorker.processPending()` consumes the `derived_dirty` queue:

- **Coalescing**: one processing unit per profile. Profile-level markers
  (`bodyweight_changed`, `profile_changed`) escalate to a full rebuild;
  workout-level markers walk only the marked completed workouts.
- **Safety pattern**: calculate + write projections + delete satisfied
  markers inside ONE transaction - a crash anywhere before COMMIT rolls
  everything back and leaves the markers (restart-safe, retry-safe).
  Processing errors are caught per profile and reported; markers stay.
- **Markers for non-completed workouts** are consumed without projection;
  completing the workout writes fresh markers.
- **Set/exercise markers** carry no profile; the worker resolves the owning
  workout. Unresolvable markers are dropped.
- **Idempotency**: all writes are keyed upserts/replacements; running the
  same canonical state twice produces the same current records and the same
  row counts.
- **Incremental == rebuild**: both paths run the identical step function;
  `rebuildAllDerivedState` (= `rebuildAll`) is the correctness oracle and is
  covered by parity tests.
- **Invalidation**: unit-system changes mark NOTHING (display-only);
  strength-standard changes mark `profile_changed` (rank rebuild, PRs are
  sex-independent); bodyweight add/delete marks `bodyweight_changed`.

`finishWorkout` remains the only canonical write path; the UI calls
`processPending()` after a successful finish and the app start performs a
non-blocking repair pass. A failed derivation never endangers a completed
workout: the summary shows
"Workout is safely saved. Ranks will be recalculated automatically."

## Performance notes

- Composite index `workouts(profile_id, status, started_at)` for the
  chronological walks; unique keys make every projection write an indexed
  point operation.
- Ranking walks reuse one builder pass per profile per processing unit and
  skip `computeRanks` entirely for workouts with no rank-relevant completed
  sets.
- Known limitation: duplicate exercise titles across distinct exercises are
  conservatively excluded from per-exercise ranks (ambiguity is surfaced as
  a reason, not hidden); they still count toward muscle aggregates.
