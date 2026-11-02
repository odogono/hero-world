# odgn_ecs

An entity-component store in SQLite, in Elixir. Mix builds and tests it without Bun, and it depends on neither Phoenix nor Mua ([ADR 0009](../../docs/adr/0009-mua-runs-entirely-on-elixir-with-edl-and-northtalk.md)). [`odgn_edl`](../odgn_edl) builds Worlds in it from EDL.

```sh
mix deps.get
mix test
```

```elixir
{:ok, world} = OdgnEcs.open("world.db")
{:ok, world} = OdgnEcs.define(world, %OdgnEcs.Component{name: "stats", columns: [%OdgnEcs.Column{name: "hp", type: :int}]})
{:ok, eid} = OdgnEcs.create(world)
:ok = OdgnEcs.put(world, eid, "stats", %{"hp" => 10})
[^eid] = OdgnEcs.query(world, where: [{"stats", "hp", 10}])
```

## How it works

- **No process:** a World is a struct over one SQLite connection. Whoever holds it is its only writer, as Mua's World process is in [ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md).
- **No implicit transactions:** callers decide where changes commit, with `begin`, `commit`, `rollback`, `savepoint`, `release`, `rollback_to` and `in_savepoint`.
- **One table per component:** each component has one typed column per property, so SQL enforces types and `unique` columns.
- **Values are checked when they are put:** properties left out take their defaults, and unknown properties, wrong types and missing required values are errors. Putting a component replaces it whole.
- **Definitions are stored in the World:** a reopened World knows its components.
- **A changed definition is applied in place when the data can follow it:** defining a component again may add a column that is optional or has a default (existing rows get the default), remove a column, make a column optional, change a default, or flip `play_state`. Changing a column's type or `unique`, adding a unique column, or making one required with no default is an `:incompatible_change` error.
- **`open/2` with `exclusive: true`** keeps SQLite's lock from the first write until the connection closes, so no other process can write the World meanwhile.
