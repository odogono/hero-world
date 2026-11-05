---
type: feat
scope: ecs
breaking: true
---

TypeScript EDL keeps component names and property keys as written, as the Elixir `odgn_edl` does. It used to camelCase them, so `is_closed: true` set an `isClosed` property and was dropped by a component whose column is `is_closed`. Write keys in EDL as the component defines them, such as `targetId` for a `targetId` column. `serializeEDL` writes them as they are too, rather than snake_casing them.
