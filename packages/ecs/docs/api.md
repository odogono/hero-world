# odgn-ecs API map

Where things are, and the behaviour the signatures don't show. Read the source for full types.

## Components: `src/component/`

```ts
import { defineComponent, s } from 'odgn-ecs/component';

const stats = defineComponent({
  id: 'stats',
  schema: { hp: s.int(), tags: s.array('string') }
});
```

- The schema builders are `s` in `component/builder.ts`: `int`, `float`, `number`, `string`, `boolean`, `enum`, `json`, `array`, `entityId`, `date`, `datetime`, `time`, `timestamp`, `now`, `uuid`, `email`, `pk`.
- `s.entityId()` is a Reference (an `eid` column): it must name an entity that exists. `.onDelete('restrict' | 'nullify' | 'cascade')` says what deleting that entity does; `restrict`, the default, makes the delete fail.
- Field types are what a read from the database returns: `datetime` is a `Date`; `date`, `time` and `timestamp` are strings. Write those types too: a write stays in the cache as given until the next query reloads it.
- `s.json<T>()` types the value as `T`, `unknown` without it. `s.array('string')` types the items, but neither is checked at runtime.
- `s.enum(['idle', 'walking'])` types the field as `'idle' | 'walking'`.
- `world.create` may leave out fields that have a `.default()`; reads still type them as present.
- Each field is a column of the same name; `id` and `eid` are reserved field names.
- A column is required unless made `.optional()`. A required column with no `.default()` gets a zero value (`''`, `0`, `false`) on create.
- `addComponent` / `removeComponent` (`component/add.ts`, `remove.ts`) are the function forms of assigning to an entity.

## World: `src/world/index.ts`

- `await createWorld([defs], options?)`, or `await createWorld(edlSource)`, which reads the component defs from the EDL and loads its entities. The database type defaults to Bun SQLite; `DatabaseType` is `bun | wasm` (`src/db/index.ts`).
- `world.create(components?)` returns a proxied entity.
- `world.get(id)` returns `{ id, world }` with no components loaded, or `null`, also for an entity deleted but not yet flushed.
- `world.delete(entity)` marks the entity for deletion when the world is next flushed.
- `world.query(opts)` returns one entity or `null`; `world.queryAll(opts)` returns an array; `world.queryIterator(opts)` returns a `using`-disposable iterator.
- `world.flush()` writes the pending changes and deletions in one transaction.
- `world.executeEDL(source, { path })`: see `docs/EDL.md`. `migrateEDL(world, source, { dryRun, prune })` brings a built world up to date with a changed EDL (`docs/EDL.md`, Migrating a world).
- Lineage and Scripts: `getEntityLineage(eid)`, `getAtomLineage(name)` and `getScriptOwners()`.
- `saveWorld` / `loadWorld` and `world.saveToJSON` / `loadFromJSON` persist a world.
- Redefining a component the World file already has changes its table in place when the change is compatible (adding an optional column or one with a default, dropping one, making one optional, changing a default or index). Anything else, such as changing a column's type or adding a required column with no default, throws a `StoreError` with code `incompatible_change`.
- World time: `world.time`, moved on by `world.advanceTime(delta)`. It is kept with the World. Events fall due by it, never by the wall clock.

## Storage: `src/store/`

The World is stored in the layout `odgn_ecs` uses, so a World file opens in either implementation (ADR 0019): `entities`, `ecs_components` (each definition as JSON) and a table `c_<name>` per component, one row per entity. `src/store/` is the port of `OdgnEcs`: `define`, `createEntity`, `put`, `remove`, `deleteEntity`, `get`, `query`, `select` and `takeChanges`. It writes straight to the database. The World's pending changes and proxies are layered over it, and `flush()` writes through it. The EDL record lives in the `edl_*` tables, and a Definition name is the `edl_definition` component, which the World keeps out of `world.defs`.

`takeChanges(store)` returns the change set since it was last called and starts a new one. Each entry is `[eid, component, 'added' | 'changed' | 'removed', data]`. Changes are recorded by temporary triggers on the connection, as in `OdgnEcs.take_changes/1`, so the set includes cascades and leaves out rolled-back changes. It covers only flushed writes.

## Queries: `src/entity/index.ts`

`QueryOptions`: `with`, `without`, `maybe` (included only when present), `where`, `args`, `orderBy`, `limit`, `offset`, `entity`, `asProxy`.

- `where` is a list of conditions, as in `odgn_ecs`: `[component, property, value]` for equality (`null` matches a missing value), or `[component, property, op, value]` with `op` one of `==`, `!=`, `<`, `<=`, `>`, `>=` and `in` (with a list). A condition implies its component.
- `where` may instead be raw SQL in which each component is joined under its own name: `'location.in = ?1'` with `args: [roomId]`. A dotted path into a `json` column (`meta.props.id`) becomes a JSON lookup.
- `orderBy`: `[[component, property, 'desc'?], …]`. Entity id breaks ties, and is the order without it.
- `with` narrows the result type: `query({ with: ['stats'] })!.stats` is typed.

## Changes and flush

All of these were checked against the code:

- **Field writes on any result are saved.** Every queried component is change-tracked, so `e.stats.hp = 7` then `flush()` writes it.
- **Assigning a component adds it; assigning `null` removes it.** `world.create` and query results are proxies that turn `e.tag = {…}` into `addComponent`. With `asProxy: false` a query returns plain objects, and such an assignment is lost.
- **Adding a component the entity has replaces it whole.** `addComponent`, `addComponents` and assignment all do this: fields left out go back to their defaults and are not merged with the old value. `eid` is each component table's primary key, so an entity has at most one row per component.
- **Queries see unflushed changes.** Entities are cached in `world.entityCache`, so a later query returns the pending value until the next flush.
- **Queries leave out entities deleted but not yet flushed.** After `world.delete(e)`, `query`, `queryAll` and `queryIterator` skip `e`, with `limit` and `offset` counting only the rest, and `world.get` returns `null`. Discarding the Change Scope that deleted it brings it back.
- The tracking lives in `component/helpers/make-tracked.ts`, and the dirty set is `world.dirtyEntities`.

## Change Scopes: `src/world/changes.ts`

A Change Scope groups pending changes so they can be kept or undone together. `ecs-talk` opens one per NorthTalk Segment.

- `const scope = world.openChanges()`, then `scope.run(() => …)`: writes inside `run` (component sets, adds and removes, `world.create`, `world.delete`) join the scope. The first time it touches an entity, it records the entity's pending state.
- `scope.commit()` keeps the changes as ordinary pending changes for the next flush. `scope.discard()` puts every entity it touched back as it was, and removes the entities it created.
- An open scope holds the entities it touched. `flush()` leaves their changes pending, and a write to one from another scope or from outside any scope throws `ChangeConflictError`.
- `world.clone` and `world.copy` write SQL directly, so a scope can't undo them.

## Systems: `src/store/system.ts`

A System is a `name`, an interval (`every`), a store `query`, an optional `select` and a `run(entities, context)` function, as `OdgnEcs.System` (ADR 0018, ADR 0020). The store keeps no clock and runs nothing itself: the caller supplies the time.

- `dueSystems(store, systems, now)`: the Systems due at `now`, in the order given. A System it hasn't seen is armed at `now`, so it first runs one interval later. One that missed several intervals runs once.
- `runSystem(store, system, now, context)`: runs it over its entities inside the caller's transaction, records `now` as its last run in `ecs_systems`, and returns what `run` returns.
- `armSystems(store, systems, now)` arms Systems when a World starts. `nextDue(store, systems)` gives when the first armed one is next due.

`spec/ecs/systems/` holds the cases both languages run.

## Events: `src/events/index.ts`

- `scheduleEvent(world, type, payload, at?)` stores an `event` component entity.
- `runEvents(world, 'move:*', fn, { flush? })` runs `fn` on each due event whose type matches, deletes it unless `fn` returns false, and flushes unless `flush` is false. The caller runs it when it chooses; events are TypeScript-only (ADR 0020), so it isn't a System. The world must register the `event` component.

## Frame loop: `src/loop/`

A free-running game loop, TypeScript-only like Events (ADR 0019). `createFrameLoop(world, systems, { frameMs, changes, discardEvery })` returns `frame()`, which advances World time by `frameMs` (1000 / 60 by default), runs each due FrameSystem in order, and flushes once, so a Frame is one commit. It returns how long each part took. The caller decides when to call it.

- A FrameSystem is `{ name, every?, run(world, frameMs) }`. It works through the World's proxies, so it sees what earlier FrameSystems in the Frame changed. This is unlike a store System, which reads committed rows and records each run in `ecs_systems`. One with `every` first runs one interval later, then once per interval. When each one last ran is kept in memory, not in the World.
- Run Events inside a Frame with `runEvents(…, { flush: false })`, so they commit with it.
- A loop takes no change sets, so by default it clears the recorded changes every `discardEvery` Frames (60), or they would pile up. With `changes: 'keep'` it leaves them for a caller that calls `takeChanges` itself.
- `packages/arcade` runs a game on it, and `bun run bench` there measures Frame times.
