---
type: feat
scope: ecs
breaking: true
---

Scripts now see a reference field, such as `location.in` or `portal.to`, as the Handle of the entity it names, so `if the in of the location of target is actor` works. A Script that still calls `ask world to resolve` on one of these fields now fails, because `resolve` takes a number. Use the field directly instead.
