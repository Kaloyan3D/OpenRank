# Third-Party Notices

This repository includes and depends on third-party software. Each component
keeps its original license. This file is verified by `pnpm licenses:check`.

## Hevy Ranks (ranking engine)

- **Source:** https://github.com/BenjiPy/hevy-ranks
- **Pinned upstream commit:** `ad4ced63f0d1b5c89920619ec3a00da8beace50d` (v0.4.0-pre1)
- **License:** MIT
- **Copyright:** Copyright (c) 2026 BenjiPy
- **Included files:**
  - `packages/ranking-core/src/legacy/engine.js` (byte-identical upstream copy)
  - `packages/ranking-core/src/legacy/LICENSE` (upstream MIT license text)
  - `packages/ranking-core/src/legacy/data/exercise-templates.json`
    (Hevy exercise template catalog distributed with the same repository)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Free Exercise DB (exercise dataset)

- **Source:** https://github.com/yuhonas/free-exercise-db
- **Pinned upstream commit:** `a859101d633a01c4a1a920d6a8ce41dabba0705f` (2026-08-30)
- **License:** Unlicense (public domain)
- **Included files:**
  - `datasets/upstream/free-exercise-db/exercises.json` (byte-identical copy of
    the upstream `dist/exercises.json` at the pinned commit; SHA-256
    `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`)
  - `datasets/upstream/free-exercise-db/LICENSE.md` (upstream Unlicense text)
- **Derived artifact:** `packages/exercise-catalog/data/catalog.v1.json` is
  generated from the pinned snapshot by `pnpm build:catalog`. Exercise images
  are NOT bundled; image paths reference the upstream repository (see
  `docs/DATA_SOURCES.md`).
- **Provenance:** `datasets/sources.lock.json` (commit, checksum, import
  timestamp). Integrity is verified by `pnpm licenses:check` and by
  `scripts/build-exercise-catalog.ts` before every build.

The Unlicense text is distributed verbatim in
`datasets/upstream/free-exercise-db/LICENSE.md`.