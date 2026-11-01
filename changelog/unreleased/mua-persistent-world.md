---
type: feat
scope: mua
---

The server keeps its world in a SQLite file (`MUA_DB`, default `data/world.db`), so it survives a restart: players, things, doors, world time, timers and Scripts carry on. The EDL builds the world only the first time; players who were online wait in Limbo until they log in again.
