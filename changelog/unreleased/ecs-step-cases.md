---
type: feat
scope: ecs
---

Add Step conformance cases in `spec/ecs/steps/`, which `odgn_ecs_engine` now runs. Each case gives EDL, Scripts, Systems, inputs and time advances, and checks each Step's result, output, change set and World state. They pin the order of timers, NorthTalk's deadline and Systems due at one World time, and the rollback of a failed Step. The TypeScript engine will run the same cases.
