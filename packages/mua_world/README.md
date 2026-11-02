# mua_world

The Elixir World for mua: one process that owns the World's SQLite database and its NorthTalk instance, and orders every change to it ([ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md)). The World is an [`odgn_ecs`](../odgn_ecs) store, built from EDL by [`odgn_edl`](../odgn_edl) once and resumed after, and its Scripts run through [`odgn_ecs_talk`](../odgn_ecs_talk). Its gameplay is being ported in parts (#103).

It builds and tests with Mix alone:

```sh
mix deps.get
mix test
```

NorthTalk's Elixir Host isn't on Hex yet, so `mix.exs` pins it to a commit of odogono/odgn-talk, the same one `odgn_ecs_talk` uses. Its compile step downloads the pinned reactor.

## How it works

- **One Step at a time:** a command or a due timer is one Step: the input, then `pump` until the Group is idle, then one `COMMIT`. Output confirming the Step reaches subscribers only after the commit ([ADR 0012](../../docs/adr/0012-world-changes-commit-before-success-is-published.md)). A failed `COMMIT` stops the World, which restarts from what was committed.
- **Callbacks use the connection directly:** they run in Tasks while the World process is blocked in `pump`, so there is one writer and no wait cycle. Each Segment is a `SAVEPOINT`, released when the Segment commits and rolled back with it.
- **What Scripts get:** what `odgn_ecs_talk` offers (Handles, the Message Path, `world`, `clock` and `timer`), and mua's own `mua` Capability. For now `mua` has only `announce place, text, except`.
- **Components:** `MuaWorld.Components` defines mua's components, ported from `coms.ts` in snake_case, before the Build.
- **Commands:** `say`, `take`, and any other verb offered to the room. This is a stand-in until command parsing and dispatch arrive (#113).
- **Vetoes:** `take thing` asks the thing by a `taking` Decision first.
- **Restarts** ([ADR 0014](../../docs/adr/0014-a-restart-keeps-timers-and-abandons-waiting-scripts.md)):
  - World time is kept in the database, so timers resume without counting downtime.
  - Every Script loads fresh.
  - A command still waiting at the last stop is abandoned, and its Character gets a notice when it next subscribes.

## Layout

| Path | Contents |
| --- | --- |
| [`lib/mua_world.ex`](lib/mua_world.ex) | The World process: Steps, commands, timers and restarts. |
| [`lib/mua_world/components.ex`](lib/mua_world/components.ex) | mua's components. |
| [`lib/mua_world/talk.ex`](lib/mua_world/talk.ex) | The `mua` Capability. |
| [`lib/mua_world/tables.ex`](lib/mua_world/tables.ex) | mua's own tables: World time, the outbox, waiting inputs and notices. |
| [`test/`](test/) | Tests against a small chapel World ([`test/fixtures/chapel`](test/fixtures/chapel)), including crashes around the commit. |
