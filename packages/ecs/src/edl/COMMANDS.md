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

Component Definitions (def)

Overview
- Define component schemas inline with EDL using `def <name> { ... }` blocks.
- Parsed alongside `atom` and `entity` definitions by the Peggy grammar.
- Output shape matches tests: `{ type: 'component', id, tableName?, columns: [...] }`.

Syntax
- Table name: `_tbl: <snake_case_table_name>` (optional)
- Column: `<name>: <type> [flags...]`
  - Flags
    - `null` — optional (default); emitted as no `optional` field
    - `not null` — required; emitted as `optional: false`
    - `is_unique` — unique; emitted as `isUnique: true`
    - `default <value...>` — default; emitted as `default: '<raw string>'`
      - Everything after `default` on the same line becomes the default value string
      - Quotes and spaces are preserved, e.g. `default "hello world"`

Example
```
def user {
  _tbl: tbl_user
  name: string null
  email: email not null is_unique
  age: int default 0
  height: float default 0.0
  is_active: boolean default true
  created_at: datetime default current_timestamp
}
```

Mixed Content
- `def` blocks can appear before/after `atom`/`entity` blocks.
- Comments (`# ...`) are supported and may appear on the same line; text after `#` is ignored.
