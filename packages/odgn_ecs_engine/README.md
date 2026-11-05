# odgn_ecs_engine

The engine above the [`odgn_ecs`](../odgn_ecs) store ([ADR 0021](../../docs/adr/0021-the-engine-is-its-own-package-in-both-languages.md)): Steps, Deliveries, Waiting inputs, World time, timers and runs of Systems, for a World whose Scripts run through [`odgn_ecs_talk`](../odgn_ecs_talk). mua's World ([`mua_world`](../mua_world)) is its Host. Mix builds and tests it without Bun.

```sh
mix deps.get
mix test
```

```elixir
engine = OdgnEcsEngine.new(world, talk, systems: systems, on_step: &publish/1)

# one Step: a list of Deliveries, or a function of the Step's handle
{{:ok, output}, engine} = OdgnEcsEngine.step(engine, [%OdgnEcsEngine.Delivery{to: eid, message: "ring"}], at: now_ms)

# runs each due timer, NorthTalk's deadline and each due System as a Step of its own
engine = OdgnEcsEngine.advance(engine, now_ms)
OdgnEcsEngine.next_deadline(engine)
```

The engine has no process and keeps no clock: the Host owns both, and gives it World time. See `OdgnEcsEngine`'s module doc for the hook, Waiting inputs, how a failed Step rolls back, and the order `advance/2` runs things due at the same World time.

## Tables

The engine keeps World time in `ecs_engine_meta`, timers in `ecs_engine_timers` and Waiting inputs in `ecs_engine_waiting` ([ADR 0022](../../docs/adr/0022-the-engine-owns-its-tables.md)). `OdgnEcsEngine.Timers` stores them and gives Scripts the `timer` Capability: a Host starts its `odgn_ecs_talk` adapter with `capabilities: [&OdgnEcsEngine.Timers.capability/1]`. A timer goes with the entity that owns it. A World whose timers were `talk_timer` entities has them moved into the table when the engine's tables are made.
