---
type: feat
scope: mua
---

Component Definitions say whether a builder may compose a new entity from them, `buildable`, in both the Elixir and TypeScript stores. mua marks `described`, `noun`, `item`, `container` and `readable`, and `place` reads its rules from those definitions. `spec/mua/components` holds mua's definitions, and both Hosts are checked against it.
