---
type: feat
scope: ecs
---

Timers are now the engine's: `odgn_ecs_engine` keeps them in `ecs_engine_timers` and gives Scripts the `timer` Capability (`OdgnEcsEngine.Timers`), instead of `odgn_ecs_talk` keeping them as `talk_timer` entities. A World's existing timers move into the table when it next starts. A Host now adds `&OdgnEcsEngine.Timers.capability/1` to the adapter's `:capabilities`.
