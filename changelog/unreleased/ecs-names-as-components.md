---
type: feat
scope: ecs
---

Character names are unique ignoring case, enforced by the World itself rather than by reading every Character. A Definition name is now an `edl_definition` component, so it goes with its entity instead of lingering in a table of its own; EDL still remembers the names of entities play deleted, so a Migration doesn't bring them back. An existing World moves its names over the next time it starts, and a column can now become unique, or compare ignoring case, when its data allows.
