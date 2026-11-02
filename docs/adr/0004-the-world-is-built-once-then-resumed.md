# The world is built from EDL once, then resumed from its file

The server keeps its world in a SQLite file (`MUA_DB`). The EDL builds it only when the file is new; every later start resumes the file as it was, so players, things, doors, world time and timers carry on. A world with Limbo is taken to be resumed. For this, EDL Lineage and Script owners are saved in the database with the components, since they used to exist only in memory.

## Consequences

- **Editing the EDL doesn't change a running world.** New rooms, items or Scripts reach it through `bun run world:migrate` (ADR 0005), or in a fresh world. Script source is read from its file on every start, so changes to a `.talk` file do apply.
- Players who were online when the server stopped wait in Limbo until they log in again.
- Migrating an existing world to a changed EDL: see ADR 0005.
