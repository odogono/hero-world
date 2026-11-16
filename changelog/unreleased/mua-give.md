---
type: feat
scope: mua
---

Characters and NPCs can hand each other things with `give X to Y` (or `hand`). The Recipient is told on their own (the new `imsg` message), and an NPC can refuse or reply from its Scripts, or give back with its own Command. Scripts can tell one Character a line with `tell mua to inform who, text`, and `announce` can leave out a list of entities.
