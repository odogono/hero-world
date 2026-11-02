# odgn_edl

The Entity Definition Language (EDL) in Elixir: it parses atoms, entities, component definitions and references. Mix builds and tests it without Bun, and it depends on neither Phoenix nor Mua ([ADR 0009](../../docs/adr/0009-mua-runs-entirely-on-elixir-with-edl-and-northtalk.md)). It is the first part of the ECS and EDL port (#96). Build, which resolves a parsed EDL into a World, comes with the Elixir ECS.

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

## How it differs from the TypeScript parser

The grammar is a rule-by-rule port of [`edl.peggy`](../ecs/src/edl/edl.peggy) to NimbleParsec. The language it accepts is the same, but what it returns differs:

- **Definitions are structs:** `OdgnEdl.Atom`, `OdgnEdl.Entity`, `OdgnEdl.ComponentDef` and `OdgnEdl.Column`.
- **References are `OdgnEdl.Ref` structs, not strings:** `$parent.items.1` parses to `%Ref{name: "parent", path: ["items", 1]}`.
- **Property names are kept as written:** they are not camelCased, so `is_closed` stays `is_closed`.
- **Errors are values:** `parse/1` returns `{:error, %OdgnEdl.Error{}}` with a line and column, and `parse!/1` raises it.
