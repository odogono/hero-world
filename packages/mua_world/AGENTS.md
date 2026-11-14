# mua_world

mua's World in Elixir. `README.md` explains how it works (Steps, Dispatch, Limbo, timers, NPCs); this file says where each part lives. Run `mix deps.get` once in a fresh worktree, then `mix test`.

## Where things are

- `lib/mua_world.ex`: the World GenServer. The public API (`command/4`, `sign_in/4`, `enter/3`, `view/3`, `reset/2`, `tick/1` …) sits at the top, around line 100–225, and each call's `handle_call` follows from line 380 on. Look up a call with `rg -n 'def <name>|handle_call\(\{?:<name>' lib/mua_world.ex` rather than reading the file through.
- A command's path: `input.ex` (parse the input) → `commands/` (`parser`, `verbs`, `scope`, `bind`) → `dispatch.ex` (room, second object, target, vetoes) → the Service Scripts in `../mua-scripts/scripts/services/`, which fill in their messages with the `messages` Library.
- `talk.ex`: the `mua` Capability that Scripts call. `admin.ex`: the `;` admin prompt.
- `components.ex`: the component definitions. `tables.ex`: mua's own SQL tables (time, outbox, pending input, NPC queue).
- `places.ex` (Limbo, Starting room), `exits.ex`, `lifecycle.ex` (homes, resets, timers, `start`), `view.ex`.
- `migration.ex`, `backup.ex`, `lock.ex`: operating a World kept in a file.
- Content: Porthleven, `priv/edl/main.edl`, which includes one file per district (`quay.edl`, `ship.edl` …) and `town.edl` for what they share. Their Scripts are in `priv/edl/scripts/<district>/`. Places' Pictures are in `priv/edl/pictures/`; `docs/pictures.md` says how one is made. `test/fixtures/house-world/` keeps the World it replaced, to test the Migration from it. The Base Verbs every World includes (`include "mua-scripts:edl/base.edl"`) are in `../mua-scripts/edl/base.edl`.

## Tests

- `test/test_helper.exs` defines `MuaWorld.Case`: `start(fixture, dir)` builds a World from `test/fixtures/<name>.edl` that ticks by hand, plus helpers that make an Account and Character and send commands.
- Gameplay tests are in `test/gameplay/`, one file per area (`dispatch_test.exs`, `locks_test.exs` …); parser tests are in `test/commands/`, and `conformance_test.exs` there runs the shared cases in `spec/mua/commands/`.
- Ideas borrowed from Ogalala: `docs/ogalala-patterns.md`.
