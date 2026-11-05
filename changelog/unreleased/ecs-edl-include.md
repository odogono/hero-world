---
type: feat
scope: ecs
---

EDL can `include` another EDL file, by a path relative to the including file or by a named root such as `"mua-scripts:edl/base.edl"` (ADR 0025). A file is read once however often it is included, and a change to an included file means the World needs a Migration. The Elixir `odgn_edl` supports it; the TypeScript EDL does not yet.
