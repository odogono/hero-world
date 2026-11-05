---
type: feat
scope: ecs
---

The engine (Steps, Deliveries, Waiting inputs, World time, timers and runs of Systems) is now its own Elixir package, `odgn_ecs_engine`, so a Host other than mua can run a World. It keeps World time and Waiting inputs in `ecs_engine_meta` and `ecs_engine_waiting`, and a mua World moves its old `mua_meta` and `mua_waiting` rows there on start. A command whose Step fails now rolls back whole and is answered with an error, instead of restarting the World.
