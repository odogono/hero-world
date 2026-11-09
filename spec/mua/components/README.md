# mua's Component Definitions

`components.json` is every component a mua World defines, as both Hosts must define it: the Elixir one (`packages/mua_world/lib/mua_world/components.ex`, with `odgn_ecs_talk`'s `location`) and the TypeScript one (`packages/mua-world/src/components.ts`). `odgn_edl`'s own components are left out: each EDL library brings them.

Each entry is the definition as `ecs_components` stores it, with its columns sorted by name, since each Host may list them in its own order:

- **`play_state`**: play changes it, so a Migration keeps what play set (ADR 0006).
- **`buildable`**: a builder may compose a new entity from it (#259).
- **`columns`**: each with `name`, `type`, `optional`, `unique`, `default`, `index`, `case_insensitive` and `on_delete`, as `odgn_ecs` has them.

A change to a mua component changes this file and both Hosts in the same PR. `test/components_test.exs` in `mua_world` and `src/__test__/components.test.ts` in `mua-world` check each Host against it.
