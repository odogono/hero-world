# look and move as Scripts

`look` and `move` used to be TypeScript (`actions/look.ts`, `actions/move.ts`).
Now NorthTalk Scripts run them (#5). The tests that covered the TypeScript
versions pass against the Scripts unchanged. They cover looking, moving, a
closed or locked door, an exit's own messages and the arrival broadcast.

## Script layout

`src/server/mua-world/behaviours/`:

- `room.talk`: the `room` Service. `on look place, actor` returns what the
  actor sees.
- `exit.talk`: the `exit` Service.
  - `on beforeTraverse actor, way, deciding` is a Decision that vetoes when
    the exit's door is closed.
  - `on traverse way, actor, origin, destination` moves the actor
    (`moveTo`). It tells both rooms (`mua announce`, using the exit's
    `messages`) and lets the scripted things there notice (`mua notice`
    with `departed` and `arrived`). It returns the passing message and
    the new room's description.
- `lib/rooms.talk`: the `rooms` Library. `describe place, actor` writes the
  room's text and `isClosed thing` checks a door or container. Both
  Services use it.

These are **Service Scripts**, a new ecs-talk feature
(`talk.loadServiceScript`). A Host object owns each one, not an atom, so no
entity's Message Path reaches them. mua sends to them by name
(`requestService`, `decideService`) and passes the room, exit and actor as
arguments. mua loads them for every world, so a world's EDL doesn't have to
attach them.

## What the Host still does in TypeScript

- **Parsing and planning** (`actions/scripted.ts`). For `look`, mua finds the
  actor's room. For `move`, `planMove` finds the exit and its destination and
  gives the refusals that need no Script: "Which direction?", "You can't go
  … from here.", and an exit that leads nowhere.
- **Dispatch** (`actions/index.ts`). The receivers are offered the command
  first, as for every verb, so a room's own Script can still answer `look`.
  Then come the veto Decisions. For `move` these are `beforeTraverse` (the
  exit Service), `beforeExit` and `beforeEnter`. Last, the scripted action
  is sent at a stage of its own, and `after<Verb>` follows.
- **The RoomView** sent to clients alongside the text (`queries/view.ts`).
- **Message templates** (`mua message`, now with an optional `owner`, which
  for a move is the exit) and delivering notices (`mua notice`).

## What was awkward

1. **A world's atoms couldn't own the core actions.** Many rooms are built
   from two scripted atoms, as in `entity chapel : room holy`. A Message Path
   follows only the rightmost scripted base (#10), so a Script on `room`
   would be skipped for those rooms. A Script on `room` would also have
   been offered every command in every room. Service Scripts avoid both
   problems. If #10 is fixed, `room` could own `look` as the issue first
   planned.
2. **Libraries couldn't call Capabilities.** ecs-talk compiled Libraries
   without Operation Declarations, so `ask world to find` in a Library
   failed to load (`unknown operation`). Its README said this worked.
   `addLibrary` now passes declarations for `world`, `clock`, `timer` and
   any Capabilities the Host names, such as `mua`. ecs-talk builds those
   declarations by hand: `@northtalk/ts` doesn't export
   `operationDeclarations` from its main entry.
3. **Filtering a list.** A Whose Clause works on a list, but on a list it is
   `every item of found whose portal is nothing`. `every element of` is only
   for a Host object's collection, and on a list it fails at run time with
   `wrong kind`. A later name in the condition needs `it's`
   (`… and it's container is nothing`). `put x after lines` adds to a list.
4. **A reply is only text.** The runner reads a Script's reply as text, so
   the structured RoomView for clients is built again in TypeScript
   (`queries/view.ts`) and picks the same things the Script does. Changing
   what a room shows means changing both files.
5. **No answer in the same pass.** A Script answers on a later Pump pass, so
   `look` and `move` now need `MuaWorld.tick`'s extra passes. The tests'
   `send` now runs a whole tick and is awaited. The synchronous
   `dispatchCommand` (used with no Scripts) refuses `look` and `move`.
6. **Names that may be keywords.** `to` is a field of `portal`, and `exit`
   and `add` are reserved words (`script-pilot.md`). Rather than find out
   whether `the to of the portal of way` parses, the Script gets the
   destination as an argument.
