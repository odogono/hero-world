---
type: feat
scope: ecs
breaking: true
---
Building a world from EDL is now the Migration of an empty world (ADR 0007), so a Build and a later Migration record Lineage, Script owners, Definition names and EDL values the same way, and migrating to the EDL a world was built from changes nothing. `executeEDL` throws on a world already built or migrated from an EDL; use `migrateEDL` to bring it up to date. `createWorld` with an EDL string builds it only when it defines atoms or entities. World's setters for Lineage, Script owners, Definition names, EDL values and the EDL hash are gone; it keeps `getAtomLineage`, `getEntityLineage`, `getScriptOwners` and `getDefinitionNames`. `adoptDefinitionNames` is removed, and with it mua's `world:migrate --adopt`.
