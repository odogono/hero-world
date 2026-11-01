---
type: fix
scope: ecs
---

Type component fields as the values the database returns: `date` and `time` as strings, `timestamp` as a number, `s.array('string')` as `string[]`, and `s.json<T>()` as `T`.
