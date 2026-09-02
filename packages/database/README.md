# @openrank/database

SQLite access layer (Phase 3). See `docs/DATABASE.md` for the schema
contract, migration policy (foreign keys ON, WAL, transactions, versioned SQL
migrations), required indexes, and the derived-data dirty-queue architecture.

This package is the **only** place allowed to talk to SQLite; everything above
it goes through repositories and domain services.
