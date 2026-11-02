---
type: fix
scope: ecs
---

Allow only one row per entity in each component table. Opening a world file that holds duplicate rows keeps the newest one for each entity and logs how many it dropped.
