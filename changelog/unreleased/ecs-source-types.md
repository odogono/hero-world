---
type: fix
scope: ecs
---

Type event payloads as `unknown` and let `getEvents`, `getAllEvents` and `getPendingEvents` take the payload's type; an empty list of event types now matches no events instead of producing invalid SQL.
