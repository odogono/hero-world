---
type: fix
scope: ecs
---

Stop losing work silently: query results are proxies by default, so assigning a component to one adds it, and `createGameLoop(world, { throwErrors: true })` rethrows a system's error instead of logging it.
