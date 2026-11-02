# A changed EDL migrates a world, keeping Play state

A world is built from EDL once and then resumed (ADR 0004), so later EDL edits never reached it. A Migration now brings an existing world up to date. Each EDL entity's Definition name is saved with its id, and a hash of the resolved EDL is saved too. When the hash differs, the server warns at start, and `world:migrate` (with `--dry-run`) applies the change.

For each entity, the components the EDL now gives it, including through its atoms, are applied like this: static components, including `exits` and `verbs`, are set to exactly what the EDL says and are removed if the EDL no longer sets them. Missing components are added. Components marked as Play state in their definition are never overwritten. Entities gone from the EDL are reported, not deleted; `--prune` moves them to Limbo.

## Considered options

- **Rebuild from scratch.** Rejected: it loses players, their inventories and world time.
- **Overwrite everything the EDL sets.** Rejected: it resets doors players opened and things they moved.
- **Overwrite only values play never touched.** Rejected for now: it needs a snapshot of every component as first built.
- **Delete removed entities.** Rejected: a player may be holding one, and Elements and timers would be orphaned.

## Consequences

- A component's definition must say whether it is Play state, and a wrong flag either clobbers play or leaves stale data.
- Renaming an entity in the EDL creates a new one and reports the old one as removed.
