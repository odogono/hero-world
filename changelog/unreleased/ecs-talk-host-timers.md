---
type: feat
scope: ecs-talk
---

Let the Host keep its own timers in the timer store: `schedule` stores one for an entity, and the `onTimer` option handles timers as they fall due instead of delivering them to Scripts. mua's EDL `timers` now use it, so there is one timer store.
