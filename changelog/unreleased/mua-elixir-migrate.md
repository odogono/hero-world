---
type: feat
scope: mua
---

Bring an Elixir World up to date with a changed EDL with `mix mua.migrate`, keeping Characters, Play state, live edits, World time and timers. It supports dry runs and pruning to Limbo, and refuses a Migration that would leave the Starting room invalid. `OdgnEdl.migrate/3` is the engine Build now runs on, and `OdgnEcs.define/2` applies compatible component changes in place.
