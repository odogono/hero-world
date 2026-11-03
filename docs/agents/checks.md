# Checks

`bun run check` runs everything CI's `check` job runs: lint, format, a typecheck and the tests of `ecs`, `helpers`, `mua_client` and `tools/`; the Elixir packages have their own CI jobs. The `pre-push` hook runs it after the commit checks in [commits.md](commits.md). `bun install` turns the hooks in [`.githooks/`](../../.githooks/) on.

## Typecheck

`bun run typecheck` ([`tools/typecheck/check.ts`](../../tools/typecheck/check.ts)) runs `tsc` on each project with its own `tsconfig.json`, and fails on any error. To see one project's errors: `cd packages/<name> && bunx tsc --noEmit -p tsconfig.json`.
