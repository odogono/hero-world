# odgn-ecs

SQLite-backed ECS. Components are defined with `defineComponent` and stored in per-component tables; `world.flush()` writes pending changes.

**Parity with `packages/odgn_ecs` (ADR 0019).** The two share a World layout and the conformance suite in `spec/ecs/`, which `src/store/__test__/conformance.test.ts` runs here and `test/conformance_test.exs` runs there. A change to the store (`src/store/`) or to EDL lands in both languages in the same PR, with a `spec/ecs/` case when the suite can say it.

- `src/store/`: the store, a port of `OdgnEcs` over the shared layout; `src/world/index.ts`: the World; `src/entity/`: queries and entity loading; `src/component/`: definitions and the change-tracking proxy; `src/store/system.ts`: Systems, as `OdgnEcs.System` (re-exported from `src/system/`); `src/edl/`: the EDL parser and loader; `src/events/`: persistent events.
- Imports inside the package are relative (`../component`), not aliases, so other packages can typecheck the sources.
- The API, and how changes, proxies and flush behave: `docs/api.md`. Read it before `src/world/index.ts`.
- EDL, the world-description language: `docs/EDL.md`. How component types are inferred: `docs/type-inference.md`.
- `src/edl/parser.ts` is generated from `src/edl/edl.peggy` by `bun run generate:edl`; edit the grammar, not the parser.
