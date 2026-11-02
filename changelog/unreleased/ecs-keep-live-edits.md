---
type: feat
scope: ecs
---

A migration now keeps any component changed since the EDL last set it, static ones included, such as a description an admin edited live, and lists it in `kept` instead of overwriting it.
