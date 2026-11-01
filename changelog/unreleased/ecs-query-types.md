---
type: fix
scope: ecs
---

Type `world.query` and `world.queryAll` results by their `with` components, so they're known to be present, and let other packages typecheck `odgn-ecs` source.
