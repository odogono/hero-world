Component Definitions (def)

Overview

- Define component schemas inline with EDL using `def <name> { ... }` blocks.
- Parsed alongside `atom` and `entity` definitions by the Peggy grammar.
- Output shape matches tests: `{ type: 'component', id, tableName?, columns: [...] }`.

Syntax

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

Atoms and Entities

Overview

- Atoms are reusable templates of components: `atom <name> { <components> }`.
- Entities can include components directly or extend atoms/entities.
- Atoms can now extend other atoms with the same `:` syntax as entities.

Syntax

- Atom with no base: `atom Name { ComponentA { ... } ComponentB { ... } }`
- Atom with bases: `atom Name: BaseA BaseB { ... }`
  - Multiple bases are space‑separated; rightmost wins on property conflicts.
- Entity with bases: `entity Name: Base1 Base2 { ... }`
  - Bases can be atoms or previously defined entities (forward refs supported).
- Identifiers or quoted strings are allowed for names in these positions.

Resolution Rules

- Inheritance merges component objects shallowly per component key.
  - Rightmost base overrides earlier bases; explicit properties inside the
    derived atom/entity override inherited ones.
- Circular inheritance is detected and reported as an error.
- Unknown atom bases inside an `atom` definition are ignored. Unknown entity
  references in an `entity` extends list are reported as errors.

Examples

```
# Atom inheritance
atom base { thing { size: 10 weight: 20 } }
atom child: base { thing { size: 15 } }

entity chest: child {}

# Multiple inheritance with rightmost precedence
atom base1 { thing { size: 1 weight: 2 } }
atom base2 { thing { size: 10 } }
entity combined: base1 base2 {}
```
