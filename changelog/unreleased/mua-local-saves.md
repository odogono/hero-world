---
type: feat
scope: mua
---

Save a Local World as a file and load one back. When playing offline, the profile menu's "Save world" downloads the World as `mua-world.db`, and "Load world…" plays a saved file in its place, in any browser. A save from an older World is migrated before it plays. A file that isn't a saved World is refused, and the World is left as it was. `odgn-ecs` databases gain `export()`, and `replaceDatabase` puts a file's bytes in place of a database on disk or in OPFS.
