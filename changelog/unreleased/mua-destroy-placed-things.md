---
type: feat
scope: mua
---

A Builder can `destroy` a thing they placed. It is gone for good and frees its place in their `max_placed`. It refuses while the thing holds anything, and the room sees "Ada unmakes the satchel." Who may destroy is the `builder`'s new `destroy` permission: `"own"` by default, or `"any"` for an Admin clearing others' things.
