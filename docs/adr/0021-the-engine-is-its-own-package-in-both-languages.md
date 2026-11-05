# The engine is its own package in both languages

The engine (Step, Delivery, waiting inputs, World time, timers and runs of Systems) moves out of `mua_world` into `odgn_ecs_engine`, with a TypeScript twin, `ecs-engine`, above `ecs` and `ecs-talk`. mua keeps its commands, outbox, notices, identities and NPC queue. ADR 0018 let the engine stay inside mua until a second consumer appeared. The browser is that consumer (ADR 0019), and the Step-level conformance cases need a seam that leaves mua's commands out. This amends ADR 0018.

A host uses the engine through four things: `step(input)`, `advance(world_time)`, which runs each due timer and System as its own Step, `next_deadline()`, and a hook called with each Step's output after its commit. The host owns the wall clock and decides when to call `advance`, so the engine keeps no clock, as the store keeps none.

## Considered Options

- **A TypeScript `mua_world` holding the engine and mua's commands together**, mirroring Elixir as it is. Rejected: parity would then cover mua's commands, which change most often, and the conformance cases could not run without them.
- **Put the engine in the store.** Rejected for the reasons in ADR 0018.

## Consequences

- The Elixir extraction lands first, so the TypeScript port copies a seam that exists.
- The order in which `advance` runs timers and Systems due at the same World time is today's Elixir order, pinned by a conformance case.
- `ecs-talk` mirrors `odgn_ecs_talk` and pins the same odgn-talk commit, which CI checks.
- Step-level conformance cases live in `spec/ecs/steps/`: EDL and NorthTalk Scripts, a list of inputs and time advances, and the World state, change set and output after each Step.
