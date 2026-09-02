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

## Exercise dataset (Phase 2 - implemented)

- Upstream: https://github.com/yuhonas/free-exercise-db
  (Unlicense / public domain)
- Pinned commit: `a859101d633a01c4a1a920d6a8ce41dabba0705f` (2026-08-30)
- Vendored snapshot: `datasets/upstream/free-exercise-db/exercises.json`
  (byte-identical, SHA-256
  `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`),
  upstream license text in the same directory. Provenance (commit, checksum,
  license, import timestamp) lives in `datasets/sources.lock.json`.
- Fields used: name, force, mechanic, equipment, primary muscles, secondary
  muscles, instructions, images, category, and the upstream `id` (kept as
  `sourceId`). The upstream `level` (difficulty) field is intentionally not
  part of the canonical schema (spec section 6).

Build pipeline (`pnpm build:catalog` -> `scripts/build-exercise-catalog.ts`):

```text
datasets/sources.lock.json (integrity gate: vendored SHA-256 must match)
        v
vendored Free Exercise DB snapshot (no network access)
        v
validation (raw upstream records)
        v
normalization (slug, category, mechanic, force, equipment, tracking type,
               canonical muscle taxonomy, alias variants)
        v
canonical OpenRank exercise schema + alias index + ranking hints
        v
packages/exercise-catalog/data/catalog.v1.json  (deterministic, byte-stable)
```

Determinism: the pipeline is pure (no timestamps in the artifact), sorts every
collection, and compares with machine-independent string ordering. Two builds
from the same pinned snapshot are byte-identical; CI regenerates the catalog
and fails on any diff. 876 exercises and 1,079 aliases are bundled.

Import-compatibility aliases: 152 Hevy exercise templates resolve to catalog
exercises (exact/canonical/relaxed matching plus a curated, validated override
list in `packages/exercise-catalog/data/hevy-alias-overrides.json`). The
remaining Hevy titles map to exercises FreeDB does not contain and are handled
by custom exercises or future curated mappings (Phase 9).

Ranking integration: `packages/exercise-catalog/data/ranking-coverage-exceptions.json`
documents every rank-eligible exercise the frozen engine cannot classify
(keyword or template). Regenerate with
`node scripts/generate-coverage-exceptions.ts` after catalog changes.

The dataset is NOT runtime-fetched. The app imports the generated catalog as a
static asset; no code path in the app contacts Free Exercise DB, GitHub, Hevy,
or any external API.

## Media

Exercise metadata + instructions are bundled; exercise images ship as a
manifest + cache (optional offline media pack). Core functionality must work
when media is not downloaded.