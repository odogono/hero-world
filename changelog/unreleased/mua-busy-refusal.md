---
type: fix
scope: mua
---

When the World falls behind, it now refuses new commands at once with `busy` instead of queueing them, and drops commands whose callers have already given up. At 400 players, every command is now acknowledged or refused within the reply timeout, and joins and timers keep working.
