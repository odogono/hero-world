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

## Step cases (`steps/*.json`)

Cases for the engine (ADR 0021): `packages/odgn_ecs_engine` runs them in `test/steps_test.exs`, and `packages/ecs-engine` runs the same files in `src/__test__/steps.test.ts`. Each file builds one World, fresh for each case:

- **`components`**: Component Definitions, as above. The adapter's `location` is always defined.
- **`edl`**: EDL source, built into the World. Entities are named by their Definition name, which is their label in the case.
- **`scripts`**: each is `{"atom": name, "source": ...}`, `{"entity": label, ...}` or `{"service": name, ...}`. Scripts get the `world`, `clock` and `timer` Capabilities, with 5000 fuel per Run.
- **`systems`** (optional): each has a `name`, an interval `every`, a `query` (`with` only), and `deliver`, the message it delivers to each entity it selects (ADR 0020). Every System is armed at World time 0.

World time starts at 0, in milliseconds. A case's `steps` run in order. Each entry is one of two kinds.

**`{"step": input, "at"?: ms, "expect": {...}}`** runs one Step. `at` moves World time first. `input` is one of these fixture shapes:

- **`deliver`**: a list of Deliveries, sent in order.
- **`decide_until_veto`**: asks each Delivery as a Decision, in order, and stops at the first Veto. The Step's `result` is `{"vetoed": reason}`, or `"passed"` if none vetoed.
- **`ask`**: one Request or Decision. The `result` is its outcome now, or `"waiting"`. A waiting one is answered in the Step that sees its Run end, as `answered`.
- **`fail`**: sends the Deliveries, Pumps, then fails, so the whole Step rolls back.

A Delivery is `{"to": label, "message": ..., "args"?: [...], "asks"?: "deliver" | "request" | "decide"}`. In `args`, `{"$ref": label}` is that entity's Handle.

**`{"advance": ms, "expect": [...], "next_deadline"?: ms | null}`** moves World time to `ms`. `expect` lists, in order, what each Step that `advance` ran should give. At one World time those are the due timers, earliest first, then NorthTalk's deadline, then the due Systems.

A Step's expectation checks only the keys it has:

- **`error: true`**: the Step rolled back. Otherwise it must have committed.
- **`result`**: the input's result. An outcome is `{"replied": value}`, `"passed"`, `{"vetoed": reason}`, `"failed"` or `"waiting"`.
- **`answered`**: the outcome a waiting input was given in this Step.
- **`output`**: `[label, text]` for each `show`, in order. Output is kept in the World's transaction, as a Host's outbox is, so a Segment or Step that rolls back sends none.
- **`changes`**: the Step's change set, as in the change-set cases.
- **`world_time`**: the Step's World time.
- **`world`**: `{label: {component: data | null}}`, read after the Step.
- **`next_deadline`**: when the engine next has work, after the Step, or `null`.
