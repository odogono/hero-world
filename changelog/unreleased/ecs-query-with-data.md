---
type: perf
scope: ecs
---

The Elixir ECS answers richer queries in one statement. `OdgnEcs.select/3` returns each entity's component data with the results, `where` takes `!=`, `<`, `<=`, `>`, `>=` and `in` as well as equality, and queries take `order_by`, `limit` and `eids`. Reference (`:eid`) columns, and columns marked `index: true`, are indexed, including in existing Worlds the next time they start. mua's room view, its command scope and due timers now use these instead of reading each entity's components one at a time.
