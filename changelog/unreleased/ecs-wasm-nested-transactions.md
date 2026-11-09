---
type: fix
scope: ecs
---

A transaction opened inside another on sqlite-wasm now nests as a savepoint, as it does on Bun's driver. It used to fail with "cannot start a transaction within a transaction".
