---
type: feat
scope: ecs
---

`odgn-ecs/loop` adds a free-running game loop. Each Frame advances World time, runs its systems, and commits once. `runEvents` takes `{ flush: false }`, so Events can run inside a Frame. By default the loop clears the changes recorded for change sets every 60 Frames, so a World that no one takes change sets from no longer grows without bound (#229).
