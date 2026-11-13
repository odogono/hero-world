---
type: feat
scope: mua
---

The main world is now Porthleven, a harbour town that shows off what mua can do, in place of the house and its grounds. Newcomers land on the Harbour Steps, its new Starting room (`MUA_STARTING_ROOM=harbour_steps`). From there they can explore:

- the quay, with a boatyard where Builders are invited to build;
- the High Street and The Ship;
- the lighthouse keeper's walled garden, with Hollis;
- a headland whose causeway to the lighthouse the tide covers every five minutes, stranding anyone on the far side until it turns.

Four NPCs keep their own routines and answer questions about the missing keeper. An optional thread leads from the noticeboard to lighting the lighthouse lamp, which the quay can see. An existing World migrates to it with `--prune`, which sends Characters in the old house to the Harbour Steps. A Local World and a Preview now define the components an EDL's `def` blocks declare, as the server does.
