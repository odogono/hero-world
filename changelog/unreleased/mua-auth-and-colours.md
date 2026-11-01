---
type: fix
scope: mua
---

Refuse `/user` and `/test/data` without a valid token with 401 rather than failing with 500, and show room exits, items, NPCs and coloured messages in the TUI instead of `(input) => applyStyle(…)`.
