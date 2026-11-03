---
type: fix
scope: mua
---

A Google account that isn't on the allowlist sees a page saying it isn't invited, instead of raw JSON. `rel/reload-env.sh` applies a changed env file, such as a new allowlist, by replacing the container, since `docker restart` keeps the old values.
