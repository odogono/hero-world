---
type: perf
scope: ecs
---

Reading query results is about twice as fast, because the row keys are worked out once per query rather than for every row. In the arcade benchmark, a Frame with 1000 asteroids drops from 3.0 ms to 2.5 ms.
