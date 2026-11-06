---
type: perf
scope: ecs
---

Writing components is about 4× cheaper. A write no longer checks first that its entity exists, because the database already refuses a write to a missing one. The new `putMany` / `put_many/3` writes one component to many entities, many rows to a statement, and the TypeScript World's `flush()` uses it. In the arcade benchmark, a Frame with 1000 asteroids drops from 4.7 ms to 3.6 ms.
