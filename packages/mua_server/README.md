# mua_server

The Phoenix side of mua: Google sign-in, the allowlist, browser sessions and the Channel a browser plays a Character through ([ADR 0013](../../docs/adr/0013-phoenix-connects-the-preact-client-to-mua.md)). The World and its gameplay are [`mua_world`](../mua_world), which knows nothing of Phoenix. Mix builds and tests it without Bun, LiveView or a database server.

```sh
mix deps.get
mix test
MUA_ALLOWLIST=you@example.com mix phx.server   # dev, on http://localhost:4000
```

`/` serves the browser client: build it first with `bun run build` (or `bun run dev`, which rebuilds on change) in [`packages/mua_client`](../mua_client).

- **Sign-in** ([ADR 0010](../../docs/adr/0010-mua-authenticates-through-google-sign-in.md)): Google, through `assent`. An identity is admitted when its verified email is on `MUA_ALLOWLIST`, and the World maps it to its Account (`MuaWorld.sign_in/4`, [ADR 0016](../../docs/adr/0016-accounts-are-entities-in-the-world.md)). Development and tests also have `POST /auth/dev {email}`.
- **The protocol:** [docs/protocol.md](docs/protocol.md).
- **Connections** (`MuaServer.Connection`): one process per Character owns its controlling Connection. It handles takeover, the 30-second grace before Limbo, logout, and the grace every Character in play gets when the World starts.

## Configuration

Everything comes from the environment, read at start (`config/runtime.exs`). In a release, a variable marked *required* that is missing stops the server at once, naming it.

| Variable | Release | Elsewhere |
| --- | --- | --- |
| `DATABASE_PATH` | required; the image sets `/data/world.db` | `data/world.db` |
| `MUA_STARTING_ROOM` | required, a Definition name | `harbour_steps` |
| `MUA_EDL` | optional | `mua_world`'s `priv/edl/main.edl` |
| `MUA_ALLOWLIST` | comma-separated emails; empty admits nobody | the same |
| `MUA_ADMINS` | comma-separated emails of admins, who can run NorthTalk at the prompt with `;` | the same |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | required | none |
| `GOOGLE_REDIRECT_URI` | optional | the public address below, plus `/auth/google/callback` |
| `SECRET_KEY_BASE` | required, at least 64 bytes (`openssl rand -base64 48`) | a fixed dev key |
| `PHX_HOST` | required: the public host name browsers use | `localhost` |
| `PHX_SCHEME`, `PHX_URL_PORT` | the public scheme and port: `https` and `443` by default, as behind `tailscale serve` or another TLS proxy | `http`, `4000` |
| `PORT` | the port the server listens on, `4000` | the same |

The public address (`PHX_SCHEME://PHX_HOST[:PHX_URL_PORT]`) is the only origin the Channel accepts.

## The release image

The [`Dockerfile`](../../Dockerfile) at the repository root builds the whole alpha: Bun bundles the client, `mix release` builds this app with the World and its EDL, and the image that runs has neither Bun nor Elixir. It runs as an unprivileged user and keeps the World on the `/data` volume, building it on first start and resuming it after.

```sh
docker build -t mua .
docker run -d --name mua -p 4000:4000 -v mua-data:/data --env-file mua.env mua
```

with `mua.env` holding at least:

```sh
PHX_HOST=almere.example.ts.net
SECRET_KEY_BASE=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MUA_STARTING_ROOM=harbour_steps
MUA_ALLOWLIST=you@example.com
MUA_ADMINS=you@example.com
```

Docker reads `--env-file` only when it creates the container, so `docker restart` keeps the old values. After changing the file, such as the allowlist, replace the container: [`rel/reload-env.sh`](rel/reload-env.sh) does that with the flags `rel/deploy-almere.sh` uses.

Development sign-in (`POST /auth/dev`) is never compiled into a release.

Backing up, changing content or the release, restoring and watching a running server are in [docs/operations.md](docs/operations.md): `GET /health`, `MuaServer.Release` commands through `bin/mua_server rpc` and `eval`, and the [`rel/maintain.sh`](rel/maintain.sh) maintenance script, and [`rel/backup.sh`](rel/backup.sh) with its systemd timer for scheduled off-machine backups. To deploy on almere behind `tailscale serve`, run [`rel/deploy-almere.sh`](rel/deploy-almere.sh) there; [`rel/mua.env.example`](rel/mua.env.example) lists the environment.
