# ECS conformance suite

Language-neutral cases that both ECS implementations run: `packages/odgn_ecs` (Elixir, `test/conformance_test.exs`) and `packages/ecs` (TypeScript, `src/store/__test__/conformance.test.ts`). The suite, not either implementation, defines what the store does. A change to the store or EDL lands in both languages in the same PR ([ADR 0019](../../docs/adr/0019-the-typescript-ecs-is-kept-at-parity-for-the-browser.md)).

## Query cases (`query/*.json`)

Each file builds one World and runs cases against it:

```json
{
  "components": [
    { "name": "stats", "columns": [{ "name": "hp", "type": "int" }] }
  ],
  "entities": [{ "id": "a", "components": { "stats": { "hp": 5 } } }],
  "cases": [
    {
      "name": "hp under 10",
      "query": { "where": [["stats", "hp", "<", 10]] },
      "expect": ["a"]
    }
  ]
}
```

- **`components`**: Component Definitions. A column has `name` and `type`, and may have `optional`, `unique`, `default`, `index` and, for an `eid` column, `on_delete` (`restrict`, `nullify` or `cascade`), as in `odgn_ecs`.
- **`entities`**: created in order, so ids ascend in file order. `id` is a label that cases use instead of a real id. Anywhere in component data or a query, `{"$ref": "label"}` stands for that entity's id.
- **`query`** options:
  - `with`: component names.
  - `where`: `[component, property, value]` for equality, or `[component, property, op, value]` with `op` one of `==`, `!=`, `<`, `<=`, `>`, `>=` and `in` (with a list). `null` equals a missing value.
  - `eids`: labels.
  - `order_by`: a list of `[component, property]` or `[component, property, "desc"]`.
  - `limit`: a number.
- **`select`** (optional): component names to read with each result. `expect` is then a list of `[label, {component: data}]`, holding only the selected components the entity has. Without `select`, `expect` lists labels in order.

## Change-set cases (`changes/*.json`)

Each case builds the World from `components` and `entities`, as the query cases do, and takes its change set. It then runs `ops` in order, takes the change set again, and compares it with `expect`.

- **`ops`**: `["create", label]`, `["put", label, component, data]`, `["remove", label, component]`, `["delete", label]`, `["begin"]`, `["commit"]`, `["rollback"]`, `["savepoint", name]` and `["rollback_to", name]`.
- **`expect`**: `[label, component, kind, data]` in entity then component order. `kind` is `added`, `changed` or `removed`. `data` is the component's data now, or `null` when removed.

## System cases (`systems/*.json`)

Each file builds the World from `components` and `entities`, as the query cases do, and defines `systems`: each a `name`, an interval `every`, a `query` (the query options above) and an optional `select`. Every System's `run` returns its entities. Each case runs `ops` in order on a fresh World:

- **`["arm", names, now]`**: arms those Systems at `now`.
- **`["due", names, now, expect]`**: the names of the Systems due at `now`, in the order given.
- **`["next_due", names, expect]`**: when the first armed one is next due, or `null`.
- **`["run", name, now, expect]`**: runs it at `now`. `expect` lists labels, or `[label, data]` with `select`.
- **`["savepoint", name]`** and **`["rollback_to", name]`**, as in the change-set cases.
