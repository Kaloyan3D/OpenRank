# Ranking Specification (Phase 1 + Phase 2 integration)

The ranking engine is a strict TypeScript port of the MIT-licensed Hevy Ranks
engine, verified by **golden compatibility tests**: for every characterization
fixture the port must produce output identical to the original engine.
Ranking behavior is frozen under the compatibility id:

```text
rankingVersion = "hevy-ranks-compatible-v1"
```

Every ranking calculation result exposes this id. Never silently change:
coefficients, thresholds, weighting, the e1RM formula, caps, or sex multiplier
behavior. Any behavior change requires a new version id
(`openrank-strength-v1`, `openrank-strength-v1.1`, ...) and fresh fixtures.

## Math

### Estimated 1RM (Epley, reps capped at 12)

```text
1RM(load, reps) = load * (1 + min(reps, 12) / 30)     reps > 1
1RM(load, 1)    = load
```

Invalid input (non-finite, load <= 0, reps <= 0) yields 0.
Reverse Epley (`weightForReps`) converts a target 1RM into the load liftable
for a given rep count - used for next-rank targets.

### Effective load per tracking type

| Type | Effective load |
| --- | --- |
| `weight_reps`, `short_distance_weight` | logged weight (null if <= 0) |
| `bodyweight_weighted` | bodyweight + added weight |
| `bodyweight_assisted` | bodyweight - assistance; null when assistance >= bodyweight |
| `bodyweight_reps`, `reps_only` | bodyweight * fraction(title, group) |
| duration / distance types | null (not rankable) |

Title detection overrides the template type for assisted/weighted bodyweight
variants (multilingual keyword markers: EN/FR/ES/DE/PT/IT).

### Muscle groups and thresholds

Six groups, each with a reference lift (coefficient 1.0) and nine thresholds
expressed as *reference 1RM equivalent / bodyweight*. Female standards multiply
thresholds by 0.72.

| Group | Reference lift | Thresholds (male) | Default coeff |
| --- | --- | --- | --- |
| Legs | Squat | 0, 0.5, 0.75, 1.0, 1.25, 1.5, 1.85, 2.3, 3.0 | 1.3 |
| Chest | Bench press | 0, 0.4, 0.6, 0.8, 1.0, 1.25, 1.55, 1.9, 2.4 | 1.1 |
| Back | Barbell row | 0, 0.4, 0.6, 0.8, 1.0, 1.25, 1.55, 1.9, 2.3 | 1.1 |
| Shoulders | Overhead press | 0, 0.3, 0.4, 0.55, 0.7, 0.85, 1.05, 1.3, 1.6 | 1.0 |
| Arms | Barbell curl | 0, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1.05, 1.3 | 1.0 |
| Core | Weighted crunch | 0, 0.15, 0.25, 0.35, 0.45, 0.6, 0.8, 1.05, 1.4 | 1.0 |

### Exercise coefficients

Per-exercise coefficients (`GROUP_COEFFS`) are matched by keyword against the
deburred title (order matters, most specific first). Unmatched exercises use
the group default coefficient scaled by an equipment factor:
machine 1.5, smith machine 1.35, cable 1.3, otherwise 1.0.
Pure bodyweight movements score via a bodyweight fraction (e.g. pull-up 0.6,
dip 0.45, push-up 0.35, core 0.25).

### Group score

A group's rank is a composite over the user's lifts on >= 3 distinct sessions
(`MIN_SESSIONS`). For each exercise: best e1RM -> coefficient ->
reference-lift equivalent -> divide by bodyweight -> `eqRatio`. The composite
is the weighted average of the top 3 compounds with weights **[1.0, 0.5, 0.25]**.

### Fallbacks and caps

- **Isolation fallback:** if no qualifying compound exists, isolation lifts
  define the rank, capped at tier index 5 (**Titan**).
- **Few-sessions fallback:** if no exercise reaches 3 sessions, whatever exists
  is used, capped at tier index 3 (**Platinum**).

### Tiers

```text
Bronze, Iron, Gold, Platinum, Diamond, Titan, Colossus, Olympian, Mythic
```

`progress` is the fraction between the current tier threshold and the next.

### Next-rank targets

`nextTierRecommendation` derives how much heavier the top compound would need
to be (others held constant) to reach the next tier, translated to a concrete
load/rep target via reverse Epley. It is an estimate, not training advice.

## Divisions (planned - not part of the v1 engine)

UI-only progress representation within a tier: IV (0-25%), III (25-50%),
II (50-75%), I (75-100%), calculated from the current tier threshold toward the
next threshold. Divisions never change strength formulas or thresholds.

## Overall rank (disabled)

`OverallRankCalculator` exists as an interface and
`RANKING_CONFIG.overallRankEnabled === false`. Overall rank stays disabled
until a deliberate calibration is designed and tested; the UI displays a
**Strength Profile** instead of a potentially misleading average.

## Golden compatibility harness

- `packages/ranking-core/src/legacy/engine.js` - untouched upstream copy
  (pinned commit, see legacy README; upstream MIT license preserved).
- `scripts/generate-ranking-fixtures.mjs` - runs the legacy engine over
  characterization scenarios and writes exact expected outputs to
  `src/testing/fixtures/*.json`.
- `src/testing/ranking.golden.test.ts` - asserts
  (a) legacy output == fixture (characterization),
  (b) port output == fixture (**100% golden compatibility - Phase 1 exit criterion**),
  (c) port output == legacy output for every scenario.

The port result additionally carries `rankingVersion`; it is stripped before
comparison because the legacy engine predates version stamping.

## Phase 2 integration: catalog -> ranking engine

The exercise catalog does not modify ranking behavior. It feeds the engine
through three mechanisms, in priority order:

1. **Template id bridge (exact):** the alias build attaches Hevy
   `exercise_template_id` values to catalog exercises (`source` =
   `hevy-templates`, `kind` = `import-source`). Passing that id to the
   engine (`RankCatalog.byId`, e.g. via `computeRanks`' catalog argument)
   classifies the exercise exactly - group and coefficient come from the
   vendored template catalog. 152 of the 453 Hevy templates resolve to a
   catalog exercise (direct, canonical word-order, relaxed movement-core with
   primary-muscle consistency, plus curated overrides).
2. **Keyword fallback (inference):** for exercises without a template bridge,
   the engine's frozen keyword table (`GROUP_HINTS`) classifies the deburred
   title. This covers 419 more rank-eligible exercises.
3. **Documented gaps:** 237 rank-eligible exercises remain unmatched and 14 are
   deliberately skipped by the engine's keyword table (cardio/mobility
   activities in a strength dataset). Every one is listed with a reason in
   `packages/exercise-catalog/data/ranking-coverage-exceptions.json`
   (regenerate via `node scripts/generate-coverage-exceptions.ts`). Coverage
   tests fail if an unclassified exercise is not documented there. Closing
   gaps further is a curated-mapping task (Phase 9), never an engine change.

**Taxonomy note (by design):** the catalog's `ranking.group` is anatomical
(major group of the primary muscles); the engine's classification follows its
own frozen routing and may differ (e.g. the engine routes the deadlift keyword
family to legs, while the catalog's primary-muscle mapping says back). The
engine is authoritative for ranks; the catalog group is for UI organization.

Templates whose Hevy primary is `full_body` are not routable by the frozen
engine (`PRIMARY_TO_GROUP` has no entry) and stay unmatched until Phase 9
provides curated mapping or a future engine version (new ranking id) adds it.