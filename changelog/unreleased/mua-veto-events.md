---
type: feat
scope: mua
---

Let rooms and things veto moves, takes and drops. Before an action changes the world, the rooms and holders involved are asked `beforeExit`, `beforeEnter`, `beforeRemove` and `beforeAdd`. They can answer with a fixed `responses { veto: { ... } }` or a NorthTalk `, deciding` handler that runs `veto "reason"`.
