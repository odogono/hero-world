---
type: fix
scope: mua
---

An admin line that fails to compile no longer crashes the World on the next line. A Service Script that fails to load now keeps its Host Object, so the next load can reuse it.
