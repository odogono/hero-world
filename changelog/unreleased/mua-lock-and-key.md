---
type: feat
scope: mua
---

Add locks and keys. A `lockable { lock: "cellar" }` thing won't open while locked; `lock`/`unlock X with Y` uses a key whose `key { opens: [...] }` lists that lock, or a fitting key you carry when none is named.
