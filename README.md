# OpenRank

> **Free forever. Open source. Offline-first. No subscriptions. Your workout data stays yours.**

OpenRank is a completely free, open-source, local-first mobile strength-training
application. It turns your workouts into a **transparent strength rank per muscle
group** - inspired by the strongest ideas in Liftoff, Hevy, and Hevy Ranks - while
staying useful with **zero backend, zero account, and zero internet connection**.

- No subscriptions, no locked ranks, no ads, no account required
- Everything works offline: exercise library, workout logging, routines, history,
  PRs, estimated 1RM, exercise ranks, muscle-group ranks, streaks, and more
- Deterministic ranking engine, versioned and covered by golden compatibility tests
- Scheduled-session streaks (rest days never break your streak) instead of unhealthy daily streaks

## Repository layout

```text
apps/
  mobile/            Expo (React Native) app - UI only, no business logic
packages/
  domain/            Pure domain models (exercise, workout, profile)
  database/          SQLite access (isolated behind repository/domain layers) - Phase 3
  ranking-core/      Ranking engine: legacy copy + strict TypeScript port + golden tests
  exercise-catalog/  Exercise catalog pipeline - Phase 2
  importers/         Import DTOs and parsers (Hevy CSV, backup) - Phase 9
  shared/            Small pure utilities shared across packages
datasets/            Pinned upstream datasets (Phase 2)
scripts/             Repo automation (fixture generation, license check)
docs/                Architecture and specification documents
```

## Development

Requires Node.js >= 20 and pnpm (activated via `packageManager`).

```bash
pnpm install
pnpm lint          # ESLint (flat config, strict TypeScript rules)
pnpm typecheck     # tsc --noEmit across every package
pnpm test          # Vitest: unit tests + ranking golden compatibility tests
pnpm fixtures:generate  # Regenerate ranking golden fixtures from the legacy engine
pnpm licenses:check     # Verify third-party license notices are intact
```

Mobile app (from `apps/mobile`): `pnpm start` (Expo dev server), `pnpm typecheck`,
`pnpm smoke:export` (bundling smoke test).

## Ranking compatibility guarantee

`packages/ranking-core` contains:

1. an **untouched copy** of the MIT-licensed [Hevy Ranks](https://github.com/BenjiPy/hevy-ranks)
   engine (pinned upstream commit, see `packages/ranking-core/src/legacy/README.md`),
2. characterization **golden fixtures** generated from that original engine,
3. a **strict TypeScript port** that must produce *identical* output for every fixture.

Ranking behavior never changes silently: coefficients, thresholds, weighting,
e1RM formula, and caps are frozen under the version id
`hevy-ranks-compatible-v1` (see `docs/RANKING_SPEC.md`).

## License

Copyright (c) 2026 The OpenRank Authors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version (`AGPL-3.0-or-later`). See [LICENSE](LICENSE).

Third-party components keep their original licenses -
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
