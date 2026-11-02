---
type: feat
scope: ecs
breaking: true
---
EDL no longer has commands. A line starting with `!` (`!set`, or a custom command) is now a parse error that names the line; write the value inline on the entity or atom instead. The `commands` option to `executeEDL` is gone, along with the `$name._count`, `$name.comp._exists` and `$name.comp.id` references that only commands could use. A Migration no longer applies `!set` (ADR 0007).
