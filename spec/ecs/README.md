# ECS conformance suite

Language-neutral cases that both ECS implementations run: `packages/odgn_ecs` (Elixir) now, and `packages/ecs` (TypeScript) from #162. The suite, not either implementation, defines what the store does ([ADR 0019](../../docs/adr/0019-the-typescript-ecs-is-kept-at-parity-for-the-browser.md)).

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
