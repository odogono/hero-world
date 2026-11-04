---
type: feat
scope: mua
---

NPCs get a heartbeat every 45 seconds of World time from a System, and their Scripts decide what to do with it, so an NPC no longer has to keep rescheduling its own timer. Hollis the gardener now potters on his heartbeat. The Elixir ECS gains Systems: a query run at an interval, at a time the caller supplies.
