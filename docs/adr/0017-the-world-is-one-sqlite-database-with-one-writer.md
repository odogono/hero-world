# The World is one SQLite database with one writer

ADR 0009 kept SQLite for World storage "initially". That is now permanent. A World is one SQLite database, and the database is the World: there is no in-memory store in front of it that holds the authoritative state. It has one writer (ADR 0011). Too much now relies on this to treat it as provisional: commit-before-publish (ADR 0012), savepoints per Segment (ADR 0015), Migration diffing against the EDL record, backups with `VACUUM INTO`, and mua's queue tables.

## Considered Options

- **An in-memory store with SQLite as a journal or snapshot**: faster per read, but persistence becomes a synchronisation problem, and every rollback guarantee would have to be rebuilt.
- **A server database such as Postgres**: allows several writers, but we have no use for them, and it adds an operational dependency.

## Consequences

- Scaling means more Worlds, not a different store. Distribution stays deferred (ADR 0011).
- Performance work on the store is SQL work: fewer statements, indexes and Reference columns. It does not mean caches that shadow the database.
