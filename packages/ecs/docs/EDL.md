# Entity Definition Language (EDL)

EDL is a compact, declarative syntax for defining atoms (reusable templates), entities (instances), and inline component schemas.

## Overview

- Define reusable data with `atom` blocks; define entities with `entity` blocks.
- Atoms and entities contain component blocks: `componentName { key: value ... }`.
- A value can be an object or array, as in JSON, but commas between entries are optional: `props: { to: $hall oneWay: true tags: ["a" "b"] }`.
- Atoms and entities can extend one or more bases using `:`. Rightmost base wins on conflicts.
- Inline component schemas can be declared with `def <name> { ... }`.
- Lines starting with `!` are commands executed after parsing; see `src/edl/COMMANDS.md`.

## Atoms

- Basic: `atom Name { ComponentA { ... } ComponentB { ... } }`
- Inheritance: `atom Name: BaseA BaseB { ... }`
  - Multiple bases allowed; merge is shallow per component, rightmost overrides.
  - Circular inheritance is detected and reported.

Example:

```
atom base { thing { size: 10 weight: 20 } }
atom child: base { thing { size: 15 } }
```

## Entities

- Basic: `entity Name { ComponentX { ... } }`
- Inheritance: `entity Name: Base1 Base2 { ... }`
  - Bases may be atoms or other entities; forward references supported.
  - Merge/override rules identical to atoms.

Example:

```
entity chest: child {}
# chest.thing -> { size: 15, weight: 20 }
```

## Components and Properties

- Component block: `ComponentName { key: value key2: value2 }`
- Keys are converted to camelCase.
- Values:
  - Strings: `"text"`
  - Numbers: `123`, `3.14`
  - Booleans: `true`, `false`
  - Null: `null`
  - Arrays: `[1, 2, 3]`
  - References: `$name`, `$name.comp.prop`, `$name.comp.items.1`
    - References resolve against inherited/own data, then recursively if the value is itself a reference.

## Inline Component Schemas (def)

Define component schemas inline; these can be used by entities like any other component.

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

- Columns: `<name>: <type> [flags...]`
  - Flags
    - `null` (default), `not null` (required)
    - `is_unique`
    - `default <raw tail of line>` (quotes/spaces preserved)

## Scripts

Attach a NorthTalk Script to an atom or entity with a plain `script` component. Declare it like any other component:

```
def script {
  src: string not null
}

atom door: exit {
  door   { is_locked: true }
  script { src: "door.talk" }
}

entity front_door: door {}
entity vault_door: door {
  script { src: "vault.talk" }
}
```

- `src` is stored as written. When `executeEDL` is given the file's `path` (`world.executeEDL(edl, { path })`), the owner's source path is resolved relative to the `.edl` file.
- Inheritance works as for any component, so `front_door` has a `script` component copied from `door`.
- Sharing rule: only an atom or entity that declares `script` itself **owns** a Script. An entity that inherits `script` from its atom shares that atom's Script and does not get its own copy. Above, `door` and `vault_door` own Scripts; `front_door` shares `door`'s.
- `world.getScriptOwners()` lists owners as `{ kind: 'atom', name, src }` or `{ kind: 'entity', eid, src }`.
- `serializeEDL` writes `script` like any other component.

## Commands

- Lines beginning with `!` are parsed as commands and executed after definitions.
- Built‑in: `!set $entity.component.prop value` adds/updates a property.
- Arguments support scalars, strings, and `$` references (can return ids, values, existence, or row ids).
- Full reference and examples: see `src/edl/COMMANDS.md`.

## Error Handling

- Parse errors include a line/column frame.
- Circular inheritance and circular value references are reported.
- Unknown entity references in `$` paths or `entity ... :` lists are reported.
- Unknown atom bases within `atom ... :` are ignored during atom resolution.

## Tips

- Prefer atoms for reusable templates; compose with multiple bases when helpful.
- Use rightmost precedence to override specific properties in derived definitions.
- Keep component shapes consistent with their `def` schema where applicable.
