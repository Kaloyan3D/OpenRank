# Data Sources

OpenRank is offline-first: upstream datasets are **pinned at build time** and
bundled; nothing is fetched at runtime.

## Ranking engine (vendored, Phase 1)

- Upstream: https://github.com/BenjiPy/hevy-ranks (MIT)
- Pinned commit: `ad4ced63f0d1b5c89920619ec3a00da8beace50d` (v0.4.0-pre1)
- Vendored: `packages/ranking-core/src/legacy/engine.js` (byte-identical) and
  `packages/ranking-core/src/legacy/data/exercise-templates.json`
  (Hevy exercise template catalog, 453 templates, used for exercise ->
  muscle-group routing and canonical title matching).
- Verification: SHA-256 checksums recorded in
  `packages/ranking-core/src/legacy/README.md`.

## Exercise dataset (Phase 2)

- Upstream: https://github.com/yuhonas/free-exercise-db
  (Unlicense / public domain)
- Expected fields: name, force, difficulty, mechanic, equipment, primary
  muscles, secondary muscles, instructions, images, category.

Pipeline (to be implemented by `scripts/build-exercise-catalog.ts` in Phase 2):

```text
Pinned upstream commit
        v
Free Exercise DB
        v
validation -> normalization -> our canonical schema -> catalog.v1.json
```

The upstream commit SHA will be stored in `datasets/sources.lock.json` so
upstream changes can never silently alter app behavior. The dataset is NOT
runtime-fetched.

## Media

Exercise metadata + instructions are bundled; exercise images ship as a
manifest + cache (optional offline media pack). Core functionality must work
when media is not downloaded.
