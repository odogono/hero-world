---
type: feat
scope: ecs-talk
breaking: true
---
An entity's Message Path now reaches the Script of every base atom, not only the rightmost one with a Script. The Lineage is linearized rightmost first, and a shared ancestor comes after every atom built on it, so `pass` in a mix-in's Script goes on to the next base. The `warn` option to `createEcsTalk` is gone, since there is nothing left to warn about. Service Scripts are now loaded as `service:<name>`. In mua, the main world's `room` atom answers `look`, and a room's own answer to `look` comes with its RoomView.
