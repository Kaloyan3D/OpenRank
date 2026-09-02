---
name: openrank-ranking-engine
description: >
  Use whenever touching OpenRank rank calculation, strength scoring,
  muscle-group aggregation, exercise matching, Epley e1RM, rank thresholds,
  ranking fixtures, ranking-core, or rank presentation derived from engine
  results — for example changing a tier threshold like Platinum or the
  Epley e1RM calculation. Treats ranking outputs as compatibility-sensitive,
  pinned behavior guarded by golden fixtures. Not needed for UI-only changes
  that merely re-render unchanged engine results.
---

# OpenRank Ranking Engine

The ranking engine is externally derived and intentionally pinned. Its
outputs are compatibility-sensitive behavior, not an implementation detail
that is free to refactor.

## Pinned semantics (current)

- Six muscle groups.
- Nine ranks.
- Epley estimated 1RM.
- Frozen caps/policies.
- Overall rank disabled.
- Warmup handling.
- Bodyweight exercise handling.
- Deterministic catalog matching.
- Golden ranking fixtures.

## Do NOT

- Casually simplify formulas.
- "Improve" thresholds from intuition.
- Introduce an overall rank unless explicitly scoped.
- Silently change caps.
- Silently change bodyweight semantics.
- Alter matching behavior without fixture evidence.
- Rewrite the engine merely for stylistic cleanliness.

## Required procedure before modifying ranking behavior

1. Identify the exact pinned/expected semantic being changed.
2. Inspect the existing golden fixtures covering that semantic.
3. Add a regression fixture representing the proposed behavior.
4. Prove whether the change is a bug fix or an intentional semantic
   migration — fixtures make this explicit instead of intuitive.
5. Run the complete ranking fixture suite.

If behavior intentionally changes, surface it explicitly as a
product/ranking decision in the report — never as a transparent refactor.

## Classify the change before editing

- Bug fix: engine output contradicts the pinned semantics or a golden
  fixture proves a defect. Fix it while keeping all unrelated fixtures
  passing.
- Intentional semantic migration: the product deliberately wants different
  ranking behavior. Add the new fixture, update affected golden fixtures,
  and surface the decision explicitly as a product/ranking decision.
- Presentation-only: rank display changes with unchanged engine results.
  Do not edit the engine; pair with `openrank-design-fidelity` instead.

## Fixture discipline

- Golden fixtures are the compatibility contract for ranking outputs.
- A proposed behavior change lands as a new regression fixture first, then
  the engine change that makes it pass.
- The complete ranking fixture suite must pass before any ranking change is
  considered verified; a partially passing suite is a FAIL, not a pass with
  caveats.

## Interaction

- Pair with a test-hardening skill (e.g. `test-driven-hardening` if
  available) for regression fixtures.
- No design skill unless rank presentation also changes; then pair with
  `openrank-design-fidelity` for the presentation layer only.
