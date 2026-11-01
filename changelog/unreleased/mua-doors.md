---
type: feat
scope: mua
---

Add doors. An exit can go through a door (`exits { north: { to: $study door: $oak_door } }`), and the way back goes through the same door, so opening, closing or locking it from either side changes both. A closed door blocks the way, `look` marks its exit `(closed)`, and the room on the other side sees it open and close.
