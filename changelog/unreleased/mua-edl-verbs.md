---
type: feat
scope: mua
---

A world can add verbs in EDL with a `verbs { defs: [...] }` component, in the same shape as the built-in verbs. A new verb is handled by Scripts; one sharing a name with a built-in adds forms that are tried first (`look under obj`). Clients are offered the new verbs to complete.
