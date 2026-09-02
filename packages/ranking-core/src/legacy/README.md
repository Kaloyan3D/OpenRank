# Legacy Hevy Ranks Engine (vendored upstream copy)

This directory contains an **untouched, byte-identical** copy of the ranking
engine from the MIT-licensed Hevy Ranks project. Do not edit these files:
they are the characterization baseline for the TypeScript port. Changes here
must come from bumping the pinned upstream commit.

- **Upstream:** https://github.com/BenjiPy/hevy-ranks
- **Pinned commit:** `ad4ced63f0d1b5c89920619ec3a00da8beace50d` (v0.4.0-pre1, 2026-07-14)
- **License:** MIT - see [LICENSE](LICENSE). Copyright (c) 2026 BenjiPy.
- Recorded in: `THIRD_PARTY_NOTICES.md` and `docs/DATA_SOURCES.md`.

## Files

| File | Purpose |
| --- | --- |
| `engine.js` | Shared ranking engine (browser + Node, zero dependency) |
| `engine.d.ts` | Type declarations we add for TS interop (not upstream) |
| `LICENSE` | Upstream MIT license text |
| `data/exercise-templates.json` | Hevy exercise template catalog (453 templates) used for group routing |

## Integrity (SHA-256)

```text
engine.js                   8952b6f9eb25b884c815d0d360342e0ad3066729ab3cdcbcf40e78b112d9a3e6
LICENSE                     437342c24ed643693db98fd8a833dd9badbcdcf0afc2214e74f346115217a323
data/exercise-templates.json cb170066882aaf8e9f2ea0202d633f4210fa6fa7fb341acd8e43a6c5c276dc2e
```

All three files are verified byte-identical to the pinned upstream commit.
`engine.d.ts` and this README are the only additive files in this directory.

## Usage

The copy is exercised by:

- `scripts/generate-ranking-fixtures.mjs` (characterization fixture generation)
- `src/testing/ranking.golden.test.ts` (golden compatibility tests)
