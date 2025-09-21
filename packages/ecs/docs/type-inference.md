# Typed World and Entity Inference

This library infers component types end‑to‑end so that worlds, entities, and queries are all strongly typed without manual annotations.

## How It Works

- `defineComponent` builds a `CDef` with a typed schema.
- `createWorld([c1, c2, ...] as const)` uses a typed overload to infer the component map from the provided `CDef` tuple.
- `world.create({ ... })` produces an entity whose component properties are strongly typed.
- `world.query({ with: [...] as const })` narrows the returned entity type to require the listed components; without `with`, components are optional.
- `asProxy: true` allows component add/remove via property assignment; call `world.flush()` to persist.

## Minimal Example

```ts
import { defineComponent, s } from '@component';
import { createWorld } from '@world';

const position = defineComponent({
  id: 'position',
  schema: { x: s.number(), y: s.number() }
});

const velocity = defineComponent({
  id: 'velocity',
  schema: { dx: s.number(), dy: s.number() }
});

// Use a const tuple so IDs are preserved for inference
const world = await createWorld([position, velocity] as const);

// Fully typed: entity.position.{x,y} are numbers
const entity = world.create({ position: { x: 10, y: 20 } });

// Query with type narrowing via `with`: result has required `position`
const found = world.query({ with: ['position'] as const });
if (found) {
  // `position` is guaranteed here
  found.position.x; // number
}

// Proxy query enables add/remove via property assignment
const proxied = world.query({
  with: ['position'] as const,
  asProxy: true
});
if (proxied) {
  proxied.velocity = { dx: 1, dy: 2 }; // typed
  world.flush(); // persist changes
}
```

## Tips

- Prefer `as const` when passing the component list to `createWorld` to retain literal IDs for the best inference.
- Use `with: ['compA', 'compB'] as const` in queries to get required component types on the result.
- Without `with`, `queryEntity` returns entities where component properties are optional (present only if joined).
- When using `asProxy: true`, remember to `world.flush()` to persist added/removed components.

## Multiple Components and `as const`

When creating a world with multiple components, pass them as a const tuple so TypeScript preserves the literal component IDs and keeps the key/value correlation:

```ts
const position = defineComponent({
  id: 'position',
  schema: { x: s.number(), y: s.number(), z: s.number() }
});
const status = defineComponent({
  id: 'status',
  schema: { status: s.string() }
});

// Good: const tuple keeps IDs literal → world/components are precisely typed
const world = await createWorld([position, status] as const);
const e = world.create({ position: { x: 1, y: 2, z: 3 } });
e.position.x; // number

// If you omit `as const`, the list widens to CDef[] and loses correlation,
// which can lead to union-like behavior on component properties.
// const world = await createWorld([position, status]); // not recommended
```
