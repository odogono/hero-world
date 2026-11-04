# The TypeScript ECS is kept at parity for the browser

ADR 0009 kept the TypeScript ECS only as a reference, to be retired once the Elixir port reached parity. We now keep it permanently, at parity with the Elixir libraries, because the browser needs a World of its own. It needs one to author and preview Worlds, to hold a client-side mirror of part of the server's World, and probably to run solo or offline play with NorthTalk, whose main implementation is TypeScript. This amends ADR 0009.

Parity is defined by a shared, language-neutral conformance suite: EDL in and World state out, query cases, and Migrations before and after. Both implementations run it, and neither one is the reference. A World file is portable: a database written by one implementation opens in the other, so the on-disk layout is part of the contract.

## Scope

- **Store and EDL** (Build, Migration, change tracking): at parity now. A change to either lands in both languages in the same PR, and CI runs the suite on both.
- **Step, Delivery, World time, timers and Systems**: brought to parity later as their own milestone, for offline play and because mua uses Systems (ADR 0020). Each run of a System is a Step, so they arrive together.
- **Events** (entities a System consumes once) and the free-running game loop: TypeScript only, until a game needs them on the server. mua's Systems deliver to Scripts instead. Events are scheduled on World time, not the wall clock.
- **Interfaces stay idiomatic.** TypeScript proxies are write syntax over the same store capabilities, not part of parity.

## Consequences

- The TypeScript storage layer is rebuilt to the Elixir layout: one typed table per Component Definition, named by the definition.
- The alasql backend is removed. The backends are Bun SQLite and sqlite-wasm.
- The conformance suite lives in `spec/ecs/` as data files that both test runners load: EDL parse output, built Worlds, query cases, Migrations and change sets. EDL parse output is included because the two parsers are written differently.
- A client mirror holds only the Character's Perception, and the change sets sent to it are filtered by the same rule, because anything in the browser can be read by its user. Change sets cover one Step each; a reconnect fetches a fresh mirror, not a replay.
