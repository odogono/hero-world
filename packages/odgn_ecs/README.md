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
[{^eid, %{"stats" => %{"hp" => 10}}}] = OdgnEcs.select(world, ["stats"], where: [{"stats", "hp", :<, 20}])
```

## How it works

- **No process:** a World is a struct over one SQLite connection. Whoever holds it is its only writer, as Mua's World process is in [ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md).
- **No implicit transactions:** callers decide where changes commit, with `begin`, `commit`, `rollback`, `savepoint`, `release`, `rollback_to` and `in_savepoint`.
- **Change sets:** `take_changes/1` returns the components added, changed or removed since it was last called, with their data, and starts a new set. Called after a commit, it gives that transaction's change set. Temporary triggers on the connection record changes, so cascades are included and rolled-back changes are not, and nothing is added to the World file. There is no persistent change log.
- **One table per component:** each component has one typed column per property, so SQL enforces types and `unique` columns.
- **Values are checked when they are put:** properties left out take their defaults, and unknown properties, wrong types and missing required values are errors. Putting a component replaces it whole. `put_many/3` puts one component on many entities, many rows to a statement, all or nothing.
- **Queries are one statement:** `query/2` finds entities by components (`with`), conditions (`where`, with `==`, `!=`, `<`, `<=`, `>`, `>=` and `in`), `eids`, `order_by` and `limit`. `select/3` takes the same options and reads the named components' data with each result, so callers needn't `get` each entity in turn. The operators are a closed set: a query that needs more is a sign the store is missing something.
- **References and chosen columns are indexed:** an `:eid` column, which holds another entity, always has an index, as does a column with `index: true`. Defining a component makes sure its indexes exist, so an existing World gains them when it next starts.
- **Text can compare ignoring case:** a column with `case_insensitive: true` matches and clashes (for `unique`) ignoring ASCII case.
- **References are kept whole:** an `:eid` column has a foreign key, so it can only hold an entity that exists. Its `on_delete` says what deleting that entity does: `:restrict` (the default) refuses with a `:referenced` error naming what refers to it, `:nullify` empties the column, and `:cascade` deletes the holding entity too. A table made before References had keys is rebuilt with them when its component is next defined, unless it holds a Reference to a missing entity, which is a `:dangling_reference` error.
- **Systems run when the caller says:** an `OdgnEcs.System` is a name, an interval, a query and a run function ([ADR 0018](../../docs/adr/0018-odgn-ecs-is-a-store-with-systems-and-the-step-lives-above-it.md)). The store keeps no clock: the caller passes the time to `System.arm/3` when the World starts, asks which are `due/3`, and runs each with `run/4` inside its own transaction. When each last ran is kept in the World, so Systems pause while it is down.
- **The conformance suite** in [`spec/ecs`](../../spec/ecs) is shared with the TypeScript ECS ([ADR 0019](../../docs/adr/0019-the-typescript-ecs-is-kept-at-parity-for-the-browser.md)); `test/conformance_test.exs` runs it.
- **Definitions are stored in the World:** a reopened World knows its components.
- **A changed definition is applied in place when the data can follow it:** defining a component again may add a column that is optional or has a default (existing rows get the default), remove a column, make a column optional, change a default, or flip `play_state` or `buildable` (a component a player may compose a new entity from). Changing `unique` or `case_insensitive` remakes the table, if its data allows. Changing a column's type, adding a unique column, or making one required with no default is an `:incompatible_change` error.
- **`open/2` with `exclusive: true`** keeps SQLite's lock from the first write until the connection closes, so no other process can write the World meanwhile.
