---
type: feat
scope: ecs-talk
---

Offer NorthTalk's standard `clock` and `timer` Capabilities. Timers set with `tell timer to schedule` are stored as ECS entities, so they survive a restart, and each belongs to the entity its Run was delivered to.
