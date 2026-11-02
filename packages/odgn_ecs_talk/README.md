# odgn_ecs_talk

A [NorthTalk](https://github.com/odogono/odgn-talk) Host Adapter for an [`odgn_ecs`](../odgn_ecs) World built by [`odgn_edl`](../odgn_edl): the Elixir port of [`ecs-talk`](../ecs-talk). Mix builds and tests it without Bun.

```sh
mix deps.get
mix test
```

```elixir
{:ok, talk} = OdgnEcsTalk.start(world, on_show: fn eid, text -> ... end)
:ok = OdgnEcsTalk.load_scripts(talk, &File.read!/1)
{:ok, pending} = OdgnEcsTalk.request(talk, eid, "look", [], now)
```

The caller drives it: it Pumps with `pump/2` inside its own transaction, as Mua's World process does ([ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md)). The World must define `OdgnEcsTalk.components/0` before its Build.

## What Scripts get

- **Handles:** each component is a read-only property of an entity: its data, or Nothing. Floats reach Scripts as Decimals, and maps as ordered maps. Elements are the entities whose Location (`location.in` by default) is the entity, in id order, named by `meta.props.id` by default.
- **Message Path:** an unhandled message climbs the scripted atoms of the entity's Lineage, linearized: each base, rightmost first, then that base's own bases, with a shared ancestor after every atom built on it (`OdgnEcsTalk.MessagePath`). An atom that sits on several paths gets a Host Object for each, running a copy of its Script named `atom@path`.
- **`world`:**
  - `change` and `moveTo` are Segment-bound Host Commands: each Segment is a SAVEPOINT, so a Segment that rolls back leaves no trace.
  - `show` is a fire-and-forget Host Command that calls the `:on_show` option.
  - `find` and `resolve` are lookups.
- **`clock`:** `now`, the Pump's Clock reading.
- **`timer`:** `schedule name, at, message, args` and `cancel name`. Timers are kept in the World as `talk_timer` entities, so they outlive the adapter. Each belongs to the entity its Run was delivered to. `due_timers/2` lists the timers due, and `fire_timer/2` delivers one.
- **Service Scripts:** `load_service_script/4` loads a Script that no Message Path reaches. Send to it with `request_service/5` and `decide_service/4`.

## How it differs from `ecs-talk`

- **Read-only properties:** components can't be set as properties. Scripts change the World through `change` and `moveTo`, so every write can roll back with its Segment (ADR 0015).
- **Handles made outside a Pump:** callbacks can't make Host Objects, so an entity made during play needs `handle/2` before a Script can reach it.
- **NorthTalk pin:** the adapter is pinned to odogono/odgn-talk#1993 for Host Commands and Library declarations.
