---
type: fix
scope: ecs
---

`addComponents` now replaces a component the entity already has. It used to save a second copy, and reads kept returning the old value.
