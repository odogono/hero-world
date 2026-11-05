---
type: feat
scope: mua
---

Verbs, Directions, Aliases, articles and each Verb's Vetoes are now World data: the Base Verbs in `packages/mua-scripts/edl/base.edl`, which a World's EDL includes with the new `include "mua-scripts:edl/base.edl"`. The Service Scripts moved there too. A Verb form's `scope: "inv"` is now `reach: "carried"`. Shared command cases in `spec/mua/commands/` check the parser and binder.
