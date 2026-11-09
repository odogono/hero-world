# Checks

In a new worktree, run `bun run setup` first: `bun install`, then `mix deps.get` in every Mix package ([`tools/elixir/deps.sh`](../../tools/elixir/deps.sh)). Without it, `mix test` stops on "Unchecked dependencies" and the first push fails in the `pre-push` hook.

`bun run check` runs everything CI's `check` job runs: lint, format, a typecheck and the tests of `ecs`, `ecs-talk`, `ecs-engine`, `helpers`, `mua_client` and `tools/`. Then `check:elixir` ([`tools/elixir/check.sh`](../../tools/elixir/check.sh)) runs, in every Mix package, what CI's Elixir jobs run: `deps.get`, `format --check-formatted`, `compile --warnings-as-errors` and `test`. It skips when `mix` isn't installed, as on CI's Bun job. The `pre-push` hook runs it after the commit checks in [commits.md](commits.md). `bun run check` takes minutes and the hook reruns it, so run it once and keep its exit status: `set -o pipefail; bun run check 2>&1 | tail -20`. `bun install` turns the hooks in [`.githooks/`](../../.githooks/) on, and they run `bun install` themselves in a worktree that has no `node_modules`.

## Typecheck

`bun run typecheck` ([`tools/typecheck/check.ts`](../../tools/typecheck/check.ts)) runs `tsc` on each project with its own `tsconfig.json`, and fails on any error. To see one project's errors: `cd packages/<name> && bunx tsc --noEmit -p tsconfig.json`.

## NorthTalk pins

`bun run check:northtalk` ([`tools/northtalk/pins.ts`](../../tools/northtalk/pins.ts)) checks that `ecs-talk`'s `@northtalk/ts` version was published from the odgn-talk commit every `mix.exs` pins (ADR 0021). It asks the npm registry, so CI runs it after `check`, not the `pre-push` hook. To move NorthTalk, pick a `@northtalk/ts` release, then set each `north_talk` ref to its `gitHead` (`npm view @northtalk/ts@<version> gitHead`).

## Woodpecker CI

A PR runs on two CI systems: GitHub Actions and Woodpecker ([`tools/ci/README.md`](../../tools/ci/README.md)). `gh pr checks` lists Woodpecker's results as `ci/woodpecker/pr/<workflow>`. Its logs are not in `gh run view`; read them from the Woodpecker API at https://taito.tail9c3af.ts.net (repo id 4): `/api/repos/4/pipelines/<n>` lists the steps, and `/api/repos/4/logs/<n>/<step-id>` returns lines whose `data` is base64. A PR is green only when both systems pass.
