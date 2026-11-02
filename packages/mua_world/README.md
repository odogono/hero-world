# mua_world

The Elixir World for mua: one process that owns the World's SQLite database and its NorthTalk instance, and orders every change to it. It proves the process model and commit boundary of [ADR 0015](../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md) before the ECS and EDL port (#96), the Phoenix work (#97) and the gameplay port (#103) build on it.

It builds and tests with Mix alone:

```sh
mix deps.get
mix test
```

NorthTalk's Elixir Host isn't on Hex yet, so `mix.exs` pins it to a commit of odogono/odgn-talk. Its compile step downloads the pinned reactor.

## How it works

- **One Step at a time:** a command or a due timer is one Step: the input, then `pump` until the Group is idle, then one `COMMIT`. Output confirming the Step reaches subscribers only after the commit ([ADR 0012](../../docs/adr/0012-world-changes-commit-before-success-is-published.md)). A failed `COMMIT` stops the World, which restarts from what was committed.
- **Callbacks use the connection directly:** they run in Tasks while the World process is blocked in `pump`, so there is one writer and no wait cycle. Each Segment is a `SAVEPOINT`, released when the Segment commits and rolled back with it.
- **What Scripts get:**
  - Every entity has a Handle with read-only `name`, `description` and `location`, and its Elements (`element "lever" of the target`).
  - Atoms are Host Objects above their entities, so a message climbs entity, atom, base atom. Only single inheritance is supported for now.
  - The Segment-bound `world` Capability: `get`, `change`, `moveTo`, `notify`, `announce` and `startTimer`. Timers live on `world` because each Grant is its own Segment participant, and one Segment couldn't use two.
  - `clock`, with `now` in World time.
- **Vetoes:** `take thing` asks the thing by a `taking` Decision first.
- **Restarts** ([ADR 0014](../../docs/adr/0014-a-restart-keeps-timers-and-abandons-waiting-scripts.md)):
  - World time is kept in the database, so timers resume without counting downtime.
  - Every Script loads fresh.
  - A command still waiting at the last stop is abandoned, and its Character gets a notice when it next subscribes.

## Layout

| Path | Contents |
| --- | --- |
| [`lib/mua_world.ex`](lib/mua_world.ex) | The World process: Steps, commands, timers and restarts. |
| [`lib/mua_world/talk.ex`](lib/mua_world/talk.ex) | The Object Kinds and Capabilities Scripts use. |
| [`lib/mua_world/store.ex`](lib/mua_world/store.ex) | The SQLite schema and queries. |
| [`test/`](test/) | Tests against a small chapel World, including crashes around the commit. |
