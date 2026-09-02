# @openrank/importers

Import DTOs and parsers (Phase 9 for implementations; the common DTO exists
now as the architecture contract). Importers produce `ImportedWorkout[]` and
never write to SQLite directly - the ImportService owns validation, mapping
preview, deduplication and persistence. See the module docblock in
`src/index.ts`.
