---
type: feat
scope: ecs
---

Both ECS stores now report each transaction's change set. `OdgnEcs.take_changes/1` and `takeChanges(store)` return the components added, changed or removed since the last call, with their data. This includes removals caused by entity deletes and cascades, and excludes changes that were rolled back. Changes are recorded per connection and nothing is added to the World file. Shared cases in `spec/ecs/changes/` hold both stores to the same behaviour. Each mua Step keeps its change set after it commits.
