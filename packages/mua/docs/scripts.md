# mua's NorthTalk Scripts

Moving through an exit runs as NorthTalk Scripts, through the [ecs-talk](../../ecs-talk/README.md) adapter. Every other verb, `look` included, is a TS action dispatched by `dispatchCommand` (`actions/`).

## Layout

Scripts live in `src/server/mua-world/edl/scripts/`. Atoms in `main.edl` attach them with a `script` component, and `src` is relative to the `.edl` file.

| Script      | Owner       | Handles                                                                                                 |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `exit.talk` | `exit` atom | `on traverse actor`: move the actor through the portal and tell the players already there               |
| `door.talk` | `door` atom | `on beforeTraverse actor, deciding`: veto while `door.is_locked`, with the portal's `msg` as the reason |

`door` extends `exit`, so a door's Message Path is door → exit. `beforeTraverse` stops at `door.talk`, and `traverse` climbs on to `exit.talk`. In the demo world the window behind the house is a locked `door`.

`MuaWorld.open()` loads the Script of every atom whose EDL declares one (`createMuaTalk` in `talk.ts`).

## How `move` reaches the Scripts

`moveAction` finds the exit for the direction in TS. If the exit has a `script`, it asks the exit's `beforeTraverse` Decision, sends a `traverse` Request if it is allowed, and returns `started`: the action system writes nothing, and the player hears back when the Scripts finish. A veto's reason is the player's message. Once `traverse` settles, if the player is in a new room, `move` shows them that room with the TS `look`. An exit without a `script`, as in the test fixtures, moves the player in TS as before.

A Script's `show actor, text` becomes a `talk:show` event, and `createShowSystem` turns it into an `outputEvent` for the actor's connection.

## Awkward parts

- **Entity-id fields read as numbers.** `the to of the portal of the target` is an id, not a Handle. Scripts call `ask world to resolve id` to get the Handle.
- **Decisions add a Pump.** The verdict arrives after the Pump that runs `beforeTraverse`, so `traverse` runs on the next one. With mua's 1-second loop, a move answers a few seconds after the command rather than on the next tick, and tests let promises settle between ticks.
- **No broadcast.** `show` targets one actor, so `exit.talk` finds the players in the destination and shows each one "X arrives."
