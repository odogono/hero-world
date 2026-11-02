---
type: feat
scope: ecs-talk
---

Scripts' `change` and `moveTo` writes commit or roll back with their Segment, so a Run that hits a Limit Fault or is Rewound leaves no trace in the World. `odgn-ecs` adds Change Scopes (`world.openChanges()`) to make this possible.
