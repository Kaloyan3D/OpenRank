# Vendored: free-exercise-db

Vendored snapshot of the Free Exercise DB for the pinned commit recorded in
`datasets/sources.lock.json`. Do not edit these files by hand: they are the
byte-exact upstream snapshot that `scripts/build-exercise-catalog.ts` consumes.

- **Upstream:** https://github.com/yuhonas/free-exercise-db
- **Pinned commit:** `a859101d633a01c4a1a920d6a8ce41dabba0705f` (2026-08-30)
- **License:** Unlicense (public domain) - see [LICENSE.md](LICENSE.md)
- **Files:**
  - `exercises.json` - upstream `dist/exercises.json` (876 exercises)
- **Integrity (SHA-256):**
  `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf` (`exercises.json`)

Images are NOT vendored (they would bloat the repository and the app bundle).
Image paths inside the catalog are upstream-relative and resolve against
`https://raw.githubusercontent.com/yuhonas/free-exercise-db/<pinned commit>/images/`
for the future optional offline media pack (see docs/DATA_SOURCES.md).
