---
type: perf
scope: ecs
---

A query that requires a component starts from that component's table instead of joining every entity, which saves a lookup per row. Results are unchanged. Queries also no longer slow down as entity ids spread out over a long-running World. A query with a raw SQL `where` keeps the old plan, so `e.eid` still works in it.
