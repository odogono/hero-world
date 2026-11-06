# ecs-talk

A [NorthTalk](https://github.com/odogono/odgn-talk) Host Adapter for an [`odgn-ecs`](../ecs) World: the TypeScript twin of [`odgn_ecs_talk`](../odgn_ecs_talk) ([ADR 0021](../../docs/adr/0021-the-engine-is-its-own-package-in-both-languages.md)). Its tests follow `odgn_ecs_talk`'s, case for case.

```ts
const talk = createEcsTalk(world, { onShow: (eid, text) => ... });
talk.loadScripts(path => readFileSync(path, 'utf8'));
const pending = talk.request(eid, 'look', [], now);
talk.pumpUntilIdle(now);
const result = await outcome(pending);
```

The caller drives it: it Pumps with `pump(now)` or `pumpUntilIdle(now)` inside its own transaction, with the Clock as epoch microseconds. The World must define `location` (exported here) before its Build.

## What Scripts get

The same as from `odgn_ecs_talk`:

- **Handles:** each component is a read-only property of an entity: its data, or Nothing. Floats reach Scripts as Decimals. A reference field (an `eid` column) holds the Handle of the entity it names, or Nothing. Elements are the entities whose Location (`location.in` by default) is the entity, in id order, named by `meta.props.id` by default.
- **Message Path:** an unhandled message climbs the scripted atoms of the entity's Lineage, linearized (`linearize`). An atom on several paths gets a Host Object for each, running a copy of its Script named `atom@path`.
- **`world`:** `change` and `moveTo` are Segment-bound Host Commands, each Segment a SAVEPOINT. `show` calls the `onShow` option. `find`, `resolve` and `named` are lookups.
- **`clock`:** `now`, the Pump's Clock reading.
- **Libraries, Service Scripts, Deliveries:** `addLibrary`, `loadServiceScript`, `putServiceScript`, `requestService` and `decideService`, and the `host` send option that a Capability reads back with `delivery(call)`.

Timers are the engine's, as in Elixir. A Host adds them through the `capabilities` option.

## How it differs from `odgn_ecs_talk`

- **Outcomes are async:** NorthTalk's TypeScript Core settles a Request's promise when the Pump answers it, so `outcome(pending)` returns a promise. It still never Pumps.
- **Errors throw:** a Script that fails to load throws, and `loadScripts` throws a `ScriptLoadError` naming its path.
- **NorthTalk pin:** `@northtalk/ts` is an exact version, published from the commit every `mix.exs` pins. `bun run check:northtalk` checks that in CI.
