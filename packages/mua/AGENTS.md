# mua

A text adventure: an Elysia server (`src/server/index.ts`, port `HUB_API_PORT`, default 3974) runs the game world, and an OpenTUI client (`src/tui/`, JSX from `@opentui/react`) talks to it over WebSocket. Run them with `bun run server` and `bun run tui`. The server keeps the world in `MUA_DB` (default `data/world.db`): the EDL builds it the first time, and later runs resume it. Delete the file to start the world afresh.

## The game world: `src/server/mua-world/`

A connection's command becomes an `inputEvent` entity (`index.ts`), then runs through the game-loop systems in `systems/`, in the order `index.ts` adds them:

1. `parse`: `commands/` parses the verb and binds words to objects in scope (`commands/bind.ts`).
2. `action`: offers the command to the room, then the second object, then the target. A NorthTalk Script on an atom may answer (`scripts/`). Otherwise the action runs: a built-in in `actions/`, or for `look` and `move` one of mua's Service Scripts in `behaviours/` (`docs/core-scripts.md`).
3. `show`: delivers a Script's `show actor, text` to the players who should see it.
4. `output`: sends each `outputEvent` to its player's connection.
5. `talk`: the `ecs-talk` Pump, which runs the Scripts.

- Components are in `coms.ts`, and the world is in `edl/main.edl` (EDL syntax: `packages/ecs/docs/EDL.md`).
- `queries/` holds the shared lookups: scope, room, player, location.
- Gameplay tests load fixture worlds from `__test__/fixtures/*.edl`.
- Ideas borrowed from Ogalala: `docs/ogalala-patterns.md`. Terms: root `GLOSSARY.md`.
