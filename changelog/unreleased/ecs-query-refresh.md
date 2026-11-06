---
type: perf
scope: ecs
---

Queries refresh an entity's cached components in place, so the objects keep their fast layout. In the arcade benchmark, a Frame with 1000 asteroids drops from 3.6 ms to 3.0 ms, and building query results no longer slows down over a long run.
