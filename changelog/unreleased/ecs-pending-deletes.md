---
type: fix
scope: ecs
---

Queries no longer return an entity deleted since the last flush, and `world.get` returns `null` for it. `limit` and `offset` count only the entities still in the World.
