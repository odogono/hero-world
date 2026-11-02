# odgn-ecs API map

Where things are, and the behaviour the signatures don't show. Read the source for full types.

## Components: `src/component/`

```ts
import { defineComponent, s } from '@component'; // 'odgn-ecs/component' outside the package

const stats = defineComponent({
  id: 'stats',
  schema: { hp: s.int(), tags: s.array('string') }
});
```

- The schema builders are `s` in `component/builder.ts`: `int`, `float`, `number`, `string`, `boolean`, `enum`, `json`, `array`, `entityId`, `date`, `datetime`, `time`, `timestamp`, `now`, `uuid`, `email`, `pk`.
- Field types are what a read from the database returns: `datetime` is a `Date`; `date` and `time` are strings; `timestamp` is a number. Write those types too: a write stays in the cache as given until the next query reloads it.
- `s.json<T>()` types the value as `T`, `unknown` without it. `s.array('string')` types the items, but neither is checked at runtime.
- `s.enum(['idle', 'walking'])` types the field as `'idle' | 'walking'`.
- `world.create` may leave out fields that have a `.default()`; reads still type them as present.
- camelCase fields become snake_case columns; `id` and `eid` are reserved field names.
- `addComponent` / `removeComponent` (`component/add.ts`, `remove.ts`) are the function forms of assigning to an entity.

## World: `src/world/index.ts`

- `await createWorld([defs], options?)`, or `await createWorld(edlSource)`, which reads the component defs from the EDL and loads its entities. The database type defaults to Bun SQLite; `DatabaseType` is `bun | wasm | alasql` (`src/db/index.ts`).
- `world.create(components?)` returns a proxied entity.
- `world.get(id)` returns `{ id, world }` with no components loaded, or `null`.
- `world.delete(entity)` marks the entity for deletion when the world is next flushed.
- `world.query(opts)` returns one entity or `null`; `world.queryAll(opts)` returns an array; `world.queryIterator(opts)` returns a `using`-disposable iterator.
- `world.flush()` writes the pending changes and deletions in one transaction.
- `world.executeEDL(source, { path })`: see `docs/EDL.md`.
- Lineage and Scripts: `getEntityLineage(eid)`, `getAtomLineage(name)` and `getScriptOwners()`.
- `saveWorld` / `loadWorld` and `world.saveToJSON` / `loadFromJSON` persist a world.

## Queries: `src/entity/index.ts`

`QueryOptions`: `with`, `without`, `maybe` (included only when present), `where`, `args`, `limit`, `offset`, `entity`, `asProxy`.

- `where` is SQL over component aliases: `'location.in = ?1'` with `args: [roomId]`. A dotted path into a `json` column (`meta.props.id`) becomes a JSON lookup.
- `with` narrows the result type: `query({ with: ['stats'] })!.stats` is typed.

## Changes and flush

All of these were checked against the code:

- **Field writes on any result are saved.** Every queried component is change-tracked, so `e.stats.hp = 7` then `flush()` writes it.
- **Assigning a component adds it; assigning `null` removes it.** `world.create` and query results are proxies that turn `e.tag = {…}` into `addComponent`. With `asProxy: false` a query returns plain objects, and such an assignment is lost.
- **Queries see unflushed changes.** Entities are cached in `world.entityCache`, so a later query returns the pending value until the next flush.
- The tracking lives in `component/helpers/make-tracked.ts`, and the dirty set is `world.dirtyEntities`.

## Change Scopes: `src/world/changes.ts`

A Change Scope groups pending changes so they can be kept or undone together. `ecs-talk` opens one per NorthTalk Segment.

- `const scope = world.openChanges()`, then `scope.run(() => …)`: writes inside `run` (component sets, adds and removes, `world.create`, `world.delete`) join the scope. The first time it touches an entity, it records the entity's pending state.
- `scope.commit()` keeps the changes as ordinary pending changes for the next flush. `scope.discard()` puts every entity it touched back as it was, and removes the entities it created.
- An open scope holds the entities it touched. `flush()` leaves their changes pending, and a write to one from another scope or from outside any scope throws `ChangeConflictError`.
- `world.clone` and `world.copy` write SQL directly, so a scope can't undo them.

## Systems and the game loop: `src/system/`

- `createSystem(fn, opts)` (`system/index.ts`): with query options, `fn` runs once per matching entity as `{ entity, world, deltaTime }`; without them, once per update.
- `createGameLoop(world)` (`system/game-loop.ts`): `addSystem(id, system, { priority, frequency, enabled })`. A system made without a world type (`createSystem(() => …)`) can be added to any world's loop. Systems run in descending `priority` (default 50), and ties run in the order they were added. `frequency: n` runs a system every n-th frame. `update(deltaTime)` runs the systems, then flushes once. Pass `createGameLoop(world, { throwErrors: true })` in tests.
- **By default, a system that throws is logged and skipped**, so a test can pass or fail for the wrong reason. `throwErrors: true` rethrows instead; mua turns it on under `bun test`.

## Events: `src/events/index.ts`

- `scheduleEvent(world, type, payload, at?)` stores an `event` component entity.
- `createEventSystem('move:*', fn)` handles due events whose type matches. The world must register the `event` component.
