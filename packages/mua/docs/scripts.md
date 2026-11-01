# mua's NorthTalk Scripts

`look` and `move` run as NorthTalk Scripts, through the [ecs-talk](../../ecs-talk/README.md) adapter.

## Layout

Scripts live in `src/server/mua-world/edl/scripts/`. Atoms in `main.edl` attach them with a `script` component, and `src` is relative to the `.edl` file.

| Script      | Owner       | Handles                                                                                                                     |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `room.talk` | `room` atom | `on look actor`: the room's name, description, takeable items, containers and exits                                         |
| `exit.talk` | `exit` atom | `on traverse actor`: move the actor through the portal, tell the players already there, then `send look` to the destination |
| `door.talk` | `door` atom | `on beforeTraverse actor, deciding`: veto while `door.is_locked`, with the portal's `msg` as the reason                     |

`door` extends `exit`, so a door's Message Path is door → exit. `beforeTraverse` stops at `door.talk`, and `traverse` climbs on to `exit.talk`. In the demo world the window behind the house is a locked `door`.

`MuaWorld.open()` loads the Script of every atom whose EDL declares one (`createMuaTalk` in `talk.ts`).

## What the Host still does in TS

- Parsing input into a `commandEvent` (`parseSystem`, `commands/`).
- In `actionSystem`, `look` delivers `look` to the player's room. `move` finds the exit for the direction, asks the `beforeTraverse` Decision, and delivers `traverse` if it is allowed. A veto's reason is the player's message. "Which direction?", "You can't go … from here." and "You are nowhere." stay in TS, since they need no world data a Script would own.
- Output: a Script's `show actor, text` becomes a `talk:show` event, and `createShowSystem` turns it into an `outputEvent` for the actor's connection. `outputSystem` is unchanged apart from reading `location`.
- Positions: things and players both use ecs-talk's `location { in }` component, so a room's Elements are what is in it. This replaces mua's `contained` component and `player.location`.

## Awkward parts

- **A Handle made inside a Run couldn't receive messages in that Run.** `group.setParent` was queued Host input that applied at the next Pump. So when `exit.talk` resolved the destination room and sent it `look`, the room had no Message Path yet and the message was lost, with no `unhandled` Report. Fixed in `@northtalk/ts` 0.6.0, where a Handle can be made with its parent ([odgn-talk#1876](https://github.com/odogono/odgn-talk/issues/1876)), and ecs-talk makes each Handle that way. A send that finds no owner now reports `unhandled` ([odgn-talk#1875](https://github.com/odogono/odgn-talk/issues/1875)).
- **Entity-id fields read as numbers.** `the to of the portal of the target` is an id, not a Handle. Scripts call `ask world to resolve id` to get the Handle.
- **Decisions add a Pump.** The verdict arrives after the Pump that runs `beforeTraverse`, so `traverse` runs on the next one, and its `show` reaches the player a tick later still. With mua's 1-second loop, a move answers in about 5 seconds rather than 3.
- **No broadcast.** `show` targets one actor, so `exit.talk` finds the players in the destination and shows each one "X arrives." The mover is no longer told of their own arrival, which the old TS broadcast did.
