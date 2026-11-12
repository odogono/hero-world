---
type: feat
scope: mua
---

A Script can destroy an entity with `destroy thing`, in both the Elixir and the TypeScript Host. Every component goes with it, so lookups, Elements and queries no longer find it, and a Step that rolls back brings it back whole. It refuses an entity that something else's Location still names.
