---
type: feat
scope: mua
---

Add `mua-local`, which runs the main World in a Web Worker for offline play (ADR 0023). The Worker owns sqlite-wasm in OPFS, NorthTalk and the TypeScript Host. It speaks the Channel's messages and keeps one local Account and Character, and a reload plays on from where it was. `odgn-ecs` now runs in a browser: the EDL reader has its own path and SHA-256 code in place of Node's, the wasm database can open in OPFS, and `createWorld` honours its `type` option, which it used to ignore.
