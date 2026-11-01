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
- `.default()` doesn't make a field optional when creating an entity, though the default is applied.
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
- **Adding or removing a component by assignment needs a proxy.** `e.tag = {…}` and `e.tag = null` work on `world.create` results and on `asProxy: true` query results. On a plain query result the assignment is silently lost.
- **Queries see unflushed changes.** Entities are cached in `world.entityCache`, so a later query returns the pending value until the next flush.
- The tracking lives in `component/helpers/make-tracked.ts`, and the dirty set is `world.dirtyEntities`.

## Systems and the game loop: `src/system/`

- `createSystem(fn, opts)` (`system/index.ts`): with query options, `fn` runs once per matching entity as `{ entity, world, deltaTime }`; without them, once per update.
- `createGameLoop(world)` (`system/game-loop.ts`): `addSystem(id, system, { priority, frequency, enabled })`. Systems run in descending `priority` (default 50), and ties run in the order they were added. `frequency: n` runs a system every n-th frame. `update(deltaTime)` runs the systems, then flushes once.
- **A system that throws is logged and skipped.** `update` doesn't rethrow, so look for `System '<id>' threw an error` in the output when a test silently does nothing.

## Events: `src/events/index.ts`

- `scheduleEvent(world, type, payload, at?)` stores an `event` component entity.
- `createEventSystem('move:*', fn)` handles due events whose type matches. The world must register the `event` component.
