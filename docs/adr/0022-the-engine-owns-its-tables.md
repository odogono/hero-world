# The engine owns its tables

World time, timers and waiting inputs move out of mua's tables into the engine's own: `ecs_engine_meta`, `ecs_engine_timers` and `ecs_engine_waiting`. A World file is portable between implementations (ADR 0019), so these tables are part of its contract, as `ecs_systems` already is. A Migration renames them in existing Worlds. mua keeps `mua_outbox`, `mua_notices`, `mua_identities` and `mua_npc_queue`, which belong to its commands, not to the engine.

The alternative was to leave the rows in `mua_meta` and `mua_waiting` and have the engine read them there. A non-mua host would then have to create mua's tables, and the engine's contract would be spelled in mua's names.

## Consequences

- Both implementations create and read the engine tables identically, and the conformance suite checks them.
- Backups and restarts (ADR 0014) carry on unchanged, because the data is still in the World database.
