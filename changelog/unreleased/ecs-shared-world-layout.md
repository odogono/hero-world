---
type: feat
scope: ecs
breaking: true
---

Store the TypeScript World in the same layout as the Elixir `odgn_ecs`, so a World file opens in either. Queries take `where` conditions with operators, `orderBy` and Reference columns (`s.entityId().onDelete(…)`), and Events fall due by World time instead of the wall clock. The alasql backend is gone, and World files from earlier versions can't be opened.
