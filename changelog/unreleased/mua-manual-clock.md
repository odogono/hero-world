---
type: fix
scope: mua
---

A World ticked by hand, as in tests, now keeps World time exactly where it was advanced to. On a slow machine, the wall clock used to leak into it, and timers fired early.
