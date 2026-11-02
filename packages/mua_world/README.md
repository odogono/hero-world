# mua_world

The Elixir World for mua: one process that owns the World's SQLite database and its NorthTalk instance, and orders every change to it ([ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md)). The World is an [`odgn_ecs`](../odgn_ecs) store, built from EDL by [`odgn_edl`](../odgn_edl) once and resumed after, and its Scripts run through [`odgn_ecs_talk`](../odgn_ecs_talk). It runs mua's gameplay (#103).

It builds and tests with Mix alone:

```sh
mix deps.get
mix test
```

NorthTalk's Elixir Host isn't on Hex yet, so `mix.exs` pins it to a commit of odogono/odgn-talk, the same one `odgn_ecs_talk` uses. Its compile step downloads the pinned reactor.

## How it works

- **One Step at a time:** a command or a due timer is one Step: the input, then `pump` until the Group is idle, then one `COMMIT`. Output confirming the Step reaches subscribers only after the commit ([ADR 0012](../../docs/adr/0012-world-changes-commit-before-success-is-published.md)). A failed `COMMIT` stops the World, which restarts from what was committed.
- **Callbacks use the connection directly:** they run in Tasks while the World process is blocked in `pump`, so there is one writer and no wait cycle. Each Segment is a `SAVEPOINT`, released when the Segment commits and rolled back with it.
- **What Scripts get:**
  - What `odgn_ecs_talk` offers: Handles, the Message Path, `world`, `clock` and `timer`.
  - mua's own `mua` Capability: `act`, `announce`, `command`, `message` and `notice`.
  - The `rooms` and `things` Libraries.
- **Components:** `MuaWorld.Components` defines mua's components, ported from `coms.ts` in snake_case, before the Build.
- **Commands:** a Character's input is parsed against the World's verbs, the built-ins plus any a `verbs` component adds (`MuaWorld.Commands`). It is bound to the things in scope, with `all`, `X and Y`, `X in Y`, `it` and `again`. "Which do you mean?" waits in `player.pending`, so it survives a restart.
- **Dispatch:** each command is offered in turn to the room, the second object and the thing acted on; a reply from a Script, or a fixed one from `responses`, handles it. Then come the veto Decisions, such as `beforeTraverse`, `beforeExit` and `beforeEnter` for a move. Last comes the action: a built-in (`MuaWorld.Actions`), or for `look` and `move` mua's Service Scripts in [`priv/behaviours`](priv/behaviours). Each question is awaited inside the command's Step, and only a Script that suspends carries the rest over to a later Step (`MuaWorld.Dispatch`). Once the action has succeeded, `after<Verb>` (such as `afterTake`) goes to the same receivers, and their replies are added below its message.
- **Rolling back:** a vetoed command never reaches its action. A built-in runs in a savepoint of its own, so one that refuses or raises leaves no partial change. A Script that fails rolls back its own Segment.
- **Locks:** `lock` and `unlock` are built in, and [`priv/behaviours/lockable.talk`](priv/behaviours/lockable.talk) does the same as a Script. Both pass the same tests.
- **`show actor, text`:** a Character sees it; any other actor passes it to the Characters inside it, so a room can speak.
- **Accounts and Characters** ([ADR 0016](../../docs/adr/0016-accounts-are-entities-in-the-world.md)): an Account is an Entity with an `account` component, and owns its Characters through `player.account`. `create_account`, `create_character`, `enter`, `leave` and `command` are each one Step, and every one that acts for a Character names its Account, which must own it. Character names are unique, ignoring case.
- **Limbo and the Starting room** (`MuaWorld.Places`): Limbo and the system actor are found by `meta.props.id`, or made on start. A new Character waits in Limbo until it enters, and one that leaves goes back there, remembering the room it left in `player.return_to`. Entering returns it to that room if the room still exists, isn't Limbo and isn't inside anything; otherwise it goes to the Starting room. The `starting_room:` option names the Starting room by Definition name, and a World refuses to start unless it is a top-level place. Phoenix's disconnect grace and takeover come with #97.
- **The main world:** [`priv/edl/main.edl`](priv/edl/main.edl), the house and walled garden, copied from `packages/mua`, with Hollis the gardener.
- **NPCs** ([ADR 0003](../../docs/adr/0003-npcs-act-through-commands.md)): an entity with `npc` acts through commands, as a Character does. A Script's `tell mua to act the target, "north"` queues the command in `mua_npc_queue`, and it runs as a Step of its own once the current Step commits. Any queued while those run waits for the next tick, so an NPC answering itself can't loop. An NPC takes the first match where a Character would be asked "which do you mean?", drops a command it can't understand, and does nothing while `npc.active` is false.
- **World time** advances while the World runs, with or without Characters, and is kept in `mua_meta`, so it pauses while the World is down. Scripts read it through `clock`.
- **`timers { every: { chime: 10 reset: 60 } }`** (`MuaWorld.Lifecycle`): mua's own timers, kept as `talk_timer`s under the script name `mua:timers`, each a Step of its own when due. `reset` resets the place; any other message goes to the entity's Scripts from the system actor. Each is stored again one interval on, or once after a long pause.
- **Homes and resets:** each located thing remembers where it started as its `home`. A reset (`MuaWorld.reset/2`, or a `reset` timer) puts back what has strayed, unless a Character carries it, and tells the place's Scripts.
- **`start`:** every scripted thing with `described` hears `start` each time the World starts, after its Scripts load, in one Step.
- **Exits:** each room's `exits` shorthand becomes exit entities on start, ways back included. Exits that already exist are kept, so this makes nothing new on a restart.
- **Restarts** ([ADR 0014](../../docs/adr/0014-a-restart-keeps-timers-and-abandons-waiting-scripts.md)):
  - World time is kept in the database, so timers resume without counting downtime.
  - Every Script loads fresh.
  - A command still waiting at the last stop is abandoned, and its Character gets a notice when it next subscribes.

## Layout

| Path | Contents |
| --- | --- |
| [`lib/mua_world.ex`](lib/mua_world.ex) | The World process: Steps, commands, timers and restarts. |
| [`lib/mua_world/commands/`](lib/mua_world/commands) | Verbs, the parser, scope and binding. |
| [`lib/mua_world/input.ex`](lib/mua_world/input.ex) | Reading input into commands: pending questions, `again`, `say to`. |
| [`lib/mua_world/dispatch.ex`](lib/mua_world/dispatch.ex) | What dispatch asks, and the plans for `look` and `move`. |
| [`lib/mua_world/actions.ex`](lib/mua_world/actions.ex), [`messages.ex`](lib/mua_world/messages.ex) | The built-in actions and their messages. |
| [`lib/mua_world/exits.ex`](lib/mua_world/exits.ex) | Exit entities from the `exits` shorthand. |
| [`lib/mua_world/components.ex`](lib/mua_world/components.ex) | mua's components. |
| [`lib/mua_world/talk.ex`](lib/mua_world/talk.ex) | The `mua` Capability. |
| [`lib/mua_world/tables.ex`](lib/mua_world/tables.ex) | mua's own tables: World time, the outbox, waiting inputs, notices and queued NPC commands. |
| [`lib/mua_world/lifecycle.ex`](lib/mua_world/lifecycle.ex) | Homes, resets and mua's `timers`. |
| [`lib/mua_world/places.ex`](lib/mua_world/places.ex) | Limbo, the system actor and the Starting room. |
| [`priv/behaviours/`](priv/behaviours) | mua's Service Scripts and Libraries, from `packages/mua`, in snake_case. |
| [`test/`](test/) | Tests against a small chapel World ([`test/fixtures/chapel`](test/fixtures/chapel)), including crashes around the commit, and gameplay tests against fixtures adapted from `packages/mua`. |
