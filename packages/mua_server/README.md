# mua_server

The Phoenix side of mua: Google sign-in, the allowlist, browser sessions and the Channel a browser plays a Character through ([ADR 0013](../../docs/adr/0013-phoenix-connects-the-preact-client-to-mua.md)). The World and its gameplay are [`mua_world`](../mua_world), which knows nothing of Phoenix. Mix builds and tests it without Bun, LiveView or a database server.

```sh
mix deps.get
mix test
MUA_ALLOWLIST=you@example.com mix phx.server   # dev, on http://localhost:4000
```

`/` serves the browser client: build it first with `bun run build` (or `bun run dev`, which rebuilds on change) in [`packages/mua_client`](../mua_client).

- **Sign-in** ([ADR 0010](../../docs/adr/0010-mua-authenticates-through-google-sign-in.md)): Google, through `assent`. An identity is admitted when its verified email is on `MUA_ALLOWLIST`, and the World maps it to its Account (`MuaWorld.sign_in/3`, [ADR 0016](../../docs/adr/0016-accounts-are-entities-in-the-world.md)). Development and tests also have `POST /auth/dev {email}`.
- **The protocol:** [docs/protocol.md](docs/protocol.md).
- **Connections** (`MuaServer.Connection`): one process per Character owns its controlling Connection. It handles takeover, the 30-second grace before Limbo, logout, and the grace every Character in play gets when the World starts.

## Configuration

| Variable | Default |
| --- | --- |
| `MUA_DB` | `data/world.db` |
| `MUA_EDL` | `mua_world`'s `priv/edl/main.edl` |
| `MUA_STARTING_ROOM` | `west_of_house` |
| `MUA_ALLOWLIST` | nobody: comma-separated emails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | none; the redirect defaults to `http://localhost:4000/auth/google/callback` |
| `SECRET_KEY_BASE`, `PORT` | in production only |
