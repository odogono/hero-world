# A Build is a Migration from an empty world; EDL has no commands

Build (`executeEDL`) and Migration (`migrateEDL`) each interpreted the EDL and recorded Lineage, Script owners, Definition names and EDL values in their own way. Their `!set` handling disagreed: a Migration kept a dotted `$a.b.c` as a literal string and skipped unknown entities silently. Now a Build is the Migration of an empty world. It keeps Build's strict errors, and it refuses a world that already has an EDL record. EDL drops `!` commands: `!set`, custom handlers, and the `_count`, `_exists` and row-id references. A `!` line is a parse error. No world used them, and the commands that query the database could not run against the planned state a Migration works from. Write a value inline on the entity or atom instead.

`!` commands began as admin commands that changed a running world. That job moves to NorthTalk typed at an admin prompt (#91), so mua has one behaviour language instead of a second DSL.

## Considered options

- **Keep `!set` with literals and bare `$name` only.** Rejected: a value written inline does the same thing, and nothing used `!set`.
- **Keep every form and teach Migration all of them.** Rejected: `_count`, `_exists` and row ids would have to be rebuilt against state that has not been written yet, for forms nobody writes.
- **Admin verbs (`@set`) or a console for the old `!` syntax.** Rejected for live editing in favour of NorthTalk, which is already the behaviour language.

## Consequences

- One module in `src/edl/` writes the EDL record. World keeps only the reads that ecs-talk and mua use.
- Running `executeEDL` on a built world throws. Use `migrateEDL`.
- `adoptDefinitionNames` and `world:migrate --adopt` are gone. A world without Definition names can't be migrated.
- mua derives exits, Places, homes and stale timers in one step after either path.
