# mua_server

The Phoenix side of mua. It calls into `mua_world` (see `../mua_world/AGENTS.md`), which knows nothing of Phoenix. Run `mix deps.get` once in a fresh worktree, then `mix test`.

- The wire protocol is `docs/protocol.md` and `lib/mua_server/protocol.ex`. Releases, backups, migrations and health are `docs/operations.md` and `lib/mua_server/release.ex`.
- A browser's path: `router.ex` → `auth_controller.ex` (Google sign-in, `POST /auth/dev`) → `admission.ex` (allowlist) → `user_socket.ex` → `character_channel.ex`. `connection.ex` holds a Character's controlling Connection: takeover, grace and Limbo.
- Configuration is read from the environment in `config/runtime.exs`; `README.md` has the table.
- Tests: `test/support/case.ex` and `fake_google.ex`; Channel behaviour is in `test/character_channel_test.exs`.
- The client is `packages/mua_client` (Bun): `bun test`, `bun run e2e` (Playwright), and `bun run load` (simulated players against a release image; results in `docs/alpha-capacity.md`).
