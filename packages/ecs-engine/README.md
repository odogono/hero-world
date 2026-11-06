# ecs-engine

The engine above the [`odgn-ecs`](../ecs) store, the TypeScript twin of [`odgn_ecs_engine`](../odgn_ecs_engine) ([ADR 0021](../../docs/adr/0021-the-engine-is-its-own-package-in-both-languages.md)). It handles Steps, Deliveries, Waiting inputs, World time, timers and runs of Systems, for a World whose Scripts run through [`ecs-talk`](../ecs-talk). Both engines run the Step cases in [`spec/ecs/steps/`](../../spec/ecs/README.md).

```ts
const talk = createEcsTalk(world, {
  capabilities: [timerCapability(world.store)]
});
const engine = createEngine(world.store, talk, { systems, onStep: publish });

// one Step: a list of Deliveries, or a function of the Step's handle
const result = await engine.step([{ to: eid, message: 'ring' }], { at: nowMs });

// runs each due timer, NorthTalk's deadline and each due System as a Step of its own
await engine.advance(nowMs);
engine.nextDeadline();
```

The engine keeps no clock: the Host gives it World time, in milliseconds. It keeps its state in the same tables as Elixir: `ecs_engine_meta`, `ecs_engine_timers` and `ecs_engine_waiting` (ADR 0022). A timer's args are stored in NorthTalk's Value Encoding, which both languages write the same way.

## How it differs from `odgn_ecs_engine`

- **Async Steps:** `step` and `advance` return promises, because a Request's outcome settles as a promise (see `ecs-talk`). Run one Step at a time: the engine is the World's single writer (ADR 0011).
- **A mutable engine:** `step` and `advance` update the engine in place rather than returning a new one.
- **No telemetry and no test faults:** there are no `:telemetry`, `:metadata` or `:fault` options, and a failed `COMMIT` throws instead of exiting a process.
