---
type: feat
scope: mua
---

`mua-world` now has a TypeScript Host, `startMuaWorld`, on `ecs-engine`. It runs Commands in the same order as `MuaWorld`, and handles Accounts, Characters and Limbo, the outbox, notices, the NPC queue, resets and timers. It loads `mua-scripts`, and passes the shared mua Step cases word for word. TypeScript component definitions can now mark a column `.caseInsensitive()`, so `player.name` is unique ignoring case, as in Elixir.
