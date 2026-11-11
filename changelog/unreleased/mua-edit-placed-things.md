---
type: feat
scope: mua
---

Builders can edit what they placed. `edit satchel` opens it in the composer, and saving changes only what the Builder touched. An edit is refused if it would strand anything, such as removing `container` from a satchel that holds things. Each Builder's `edit` permission says whose things it may edit (`none`, `own` or `any`), and `place` says whether it may place new ones.
