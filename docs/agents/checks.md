# Checks

`bun run check` runs everything CI's `check` job runs: lint, format, a typecheck and the tests of `ecs`, `ecs-talk`, `helpers`, `mua_client` and `tools/`. Then `check:elixir` ([`tools/elixir/check.sh`](../../tools/elixir/check.sh)) runs, in every Mix package, what CI's Elixir jobs run: `deps.get`, `format --check-formatted`, `compile --warnings-as-errors` and `test`. It skips when `mix` isn't installed, as on CI's Bun job. The `pre-push` hook runs it after the commit checks in [commits.md](commits.md). `bun install` turns the hooks in [`.githooks/`](../../.githooks/) on, and they run `bun install` themselves in a worktree that has no `node_modules`.

## Typecheck

`bun run typecheck` ([`tools/typecheck/check.ts`](../../tools/typecheck/check.ts)) runs `tsc` on each project with its own `tsconfig.json`, and fails on any error. To see one project's errors: `cd packages/<name> && bunx tsc --noEmit -p tsconfig.json`.

## NorthTalk pins

`bun run check:northtalk` ([`tools/northtalk/pins.ts`](../../tools/northtalk/pins.ts)) checks that `ecs-talk`'s `@northtalk/ts` version was published from the odgn-talk commit every `mix.exs` pins (ADR 0021). It asks the npm registry, so CI runs it after `check`, not the `pre-push` hook. To move NorthTalk, pick a `@northtalk/ts` release, then set each `north_talk` ref to its `gitHead` (`npm view @northtalk/ts@<version> gitHead`).
