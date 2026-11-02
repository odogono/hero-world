# odgn_edl

The Entity Definition Language (EDL) in Elixir: it parses atoms, entities, component definitions and references, and builds a World from them in [`odgn_ecs`](../odgn_ecs). Mix builds and tests it without Bun, and it depends on neither Phoenix nor Mua ([ADR 0009](../../docs/adr/0009-mua-runs-entirely-on-elixir-with-edl-and-northtalk.md)).

```sh
mix deps.get
mix test
```

```elixir
{:ok, [%OdgnEdl.Atom{}, %OdgnEdl.Entity{}]} =
  OdgnEdl.parse("""
  atom chest { container { capacity: 50 } }
  entity lockable_chest: chest { lockable { key: $brass_key } }
  """)
```

## Building a World

`OdgnEdl.load/3` builds an empty World from EDL, or resumes one already built from the same EDL: a World is built once, then resumed ([ADR 0004](../../docs/adr/0004-the-world-is-built-once-then-resumed.md)). A World built from a different EDL needs a Migration (#100), so for now it is an error.

```elixir
{:ok, world} = OdgnEcs.open("world.db")
{:ok, world, :built} = OdgnEdl.load(world, File.read!("main.edl"), path: "main.edl")
```

A Build ([ADR 0007](../../docs/adr/0007-a-build-is-a-migration-from-an-empty-world.md)):

- Defines the `def` components.
- Makes every entity before resolving references, so they can point forwards.
- Merges each entity's atoms, rightmost winning property by property, then its own components.
- Records Lineage, Script owners, Definition names and the values the EDL set, which a later Migration compares play against ([ADR 0008](../../docs/adr/0008-a-migration-keeps-any-component-changed-since-the-edl-set-it.md)).

It runs in one savepoint, so any error leaves the World as it was. `OdgnEdl.entity_named/2`, `entity_lineage/2`, `atom_lineage/2`, `script_owners/1` and `definition_names/1` read what it recorded.

Lineage is the atoms a definition directly extends, in order. Linearizing them into a Message Path is left to the Script host.

## How the parser differs from the TypeScript parser

The grammar is a rule-by-rule port of [`edl.peggy`](../ecs/src/edl/edl.peggy) to NimbleParsec. The language it accepts is the same, but what it returns differs:

- **Definitions are structs:** `OdgnEdl.Atom`, `OdgnEdl.Entity`, `OdgnEdl.ComponentDef` and `OdgnEdl.Column`.
- **References are `OdgnEdl.Ref` structs, not strings:** `$parent.items.1` parses to `%Ref{name: "parent", path: ["items", 1]}`.
- **Property names are kept as written:** they are not camelCased, so `is_closed` stays `is_closed`.
- **Errors are values:** `parse/1` returns `{:error, %OdgnEdl.Error{}}` with a line and column, and `parse!/1` raises it.
