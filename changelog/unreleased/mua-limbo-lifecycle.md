---
type: feat
scope: mua
---

Add Limbo and a system actor. A player who disconnects waits in Limbo and comes back where they left. Things remember their `home`: resetting a place puts strayed things back and sends `reset` to its Scripts. Scripts hear `start` when the world begins.
