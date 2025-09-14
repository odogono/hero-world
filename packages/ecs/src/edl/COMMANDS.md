EDL Commands

Overview
- Lines starting with `!` are treated as commands and executed in order after entity/atom parsing.
- Commands are stripped before EDL parsing; they do not affect the grammar.
- Built-in: `!set $entity.component.prop value` — sets or adds a component property.
- Custom commands: pass handlers with `executeEDL(world, edl, { commands: { '!name': handler } })`.

Argument Resolution
- Scalars: `true`, `false`, `null`, integers, and floats are coerced.
- Strings: use quotes for spaces/escapes, e.g., `"hello world"`.
- Entity refs:
  - `$name` → entity id (number)
  - `$name.id` or `$name.eid` → entity id (number)
  - `$name._count` → number of components attached to the entity
- Component refs:
  - `$name.comp.prop` → resolved property value (strings may reference other `$` paths)
  - `$name.comp.id` or `$name.comp._row_id` → row id from the component table
  - `$name.comp._exists` → `true` if a row exists for that component on the entity, else `false`

Notes
- Entities and components created by definitions are flushed before commands run, so refs can resolve to DB-backed ids.
- `!set`:
  - If the component exists, sets the property via tracked proxy.
  - If missing, creates the component with minimal defaults derived from its schema and sets the property.
  - Actual persistence occurs on the final flush after all commands finish.

Examples
- `!set $chest.thing.weight 40`
- `!examine $chest.thing.weight $chest "label with spaces" 13 true`
- `!inspect $player.health.id $player.health._exists $player._count`
