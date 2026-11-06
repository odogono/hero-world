---
type: feat
scope: ecs
---

A new `arcade` package runs an asteroids-style game on the ECS at 60 Frames a second, with a headless benchmark (`bun run bench`) that reports Frame times against an 8 ms budget. In-memory SQLite stays within budget up to about 500 asteroids.
