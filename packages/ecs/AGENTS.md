# odgn-ecs

SQLite-backed ECS. Components are defined with `defineComponent` and stored in per-component tables; `world.flush()` writes pending changes.

- `src/world/index.ts`: the World; `src/entity/`: queries and entity loading; `src/component/`: definitions and the change-tracking proxy; `src/system/`: systems and the game loop; `src/edl/`: the EDL parser and loader; `src/events/`: persistent events.
- Imports inside the package are relative (`../component`), not aliases, so other packages can typecheck the sources.
- The API, and how changes, proxies and flush behave: `docs/api.md`. Read it before `src/world/index.ts`.
- EDL, the world-description language: `docs/EDL.md`. How component types are inferred: `docs/type-inference.md`.
- `src/edl/parser.ts` is generated from `src/edl/edl.peggy` by `bun run generate:edl`; edit the grammar, not the parser.
