---
type: fix
scope: mua
---

A World whose Library, Service or EDL Script fails to load now stops with `{:script_load_failed, path, diagnostics}` and logs each problem as `path:line:col message`. It used to crash with a `MatchError` that didn't name the file.
