---
type: feat
scope: ecs
breaking: true
---

TypeScript Systems now take the Elixir form: a query, an interval and a function. The caller asks which are due at a World time it supplies, and when each last ran is kept in `ecs_systems`. `dueSystems`, `runSystem`, `armSystems` and `nextDue` replace `createGameLoop` and `createSystem`. `runEvents(world, type, fn)` replaces `createEventSystem`. Shared cases in `spec/ecs/systems/` hold both languages to the same behaviour.
