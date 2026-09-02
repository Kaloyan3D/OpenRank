# Contributing

Thanks for helping make OpenRank better. Please keep the product promise in
mind: free, open-source, offline-first, no accounts, no paywalled ranks.

## Getting started

```bash
pnpm install
pnpm test && pnpm lint && pnpm typecheck
```

All three must pass locally before you open a PR. CI enforces the same checks
plus a license audit and an Android build smoke test.

## Ground rules

1. **SQLite is the source of truth.** React/Zustand state is temporary UI state only.
2. **No ranking logic outside `packages/ranking-core`.** UI components must never
   contain ranking formulas.
3. **Ranking behavior changes require a new ranking version.** Coefficients,
   thresholds, weighting, the e1RM formula, caps, and sex multipliers are frozen
   under `hevy-ranks-compatible-v1`. Any intentional behavior change needs new
   golden fixtures and a version bump (see `docs/RANKING_SPEC.md`).
4. **Golden tests must stay green.** `packages/ranking-core` compares the
   TypeScript port against the untouched legacy engine output-for-output.
   If they diverge, you broke compatibility - fix it or deliberately re-version.
5. **Kilograms internally.** Convert at the edges only; never store pounds.
6. **Offline first.** No feature may require a network connection, account, or backend.
7. **Strict TypeScript everywhere.** No `any`, no suppressed errors without a
   comment explaining why.
8. **Do not weaken tests to make them pass.** Fix the code instead.

## Commit style

Use short, imperative subjects (`Add division thresholds to RANKING_SPEC`).
PRs must include tests for behavior changes.

## Licensing

By contributing you agree your work is released under the repository license
(AGPL-3.0-or-later). New third-party dependencies must be documented in
`THIRD_PARTY_NOTICES.md` and must be license-compatible.
