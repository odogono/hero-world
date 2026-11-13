---
type: feat
scope: mua
---

A Builder can put away a thing they placed with `store`, and bring it back to the room they're in with `unstore`. `stored` lists what they can bring back. A stored thing keeps what it holds and still counts against their `max_placed`, and a reset leaves it stored. Who may store is the `builder`'s new `store` permission: `"own"` by default, or `"any"` for an Admin.
