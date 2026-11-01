# Checks

`bun run check` runs everything CI's `check` job runs: lint, format, a typecheck and the tests of `ecs`, `ecs-talk`, `helpers`, `mua` and `tools/`. The `pre-push` hook runs it after the commit checks in [commits.md](commits.md). `bun install` turns the hooks in [`.githooks/`](../../.githooks/) on.

## Typecheck

`bun run typecheck` ([`tools/typecheck/check.ts`](../../tools/typecheck/check.ts)) runs `tsc` on each project with its own `tsconfig.json`, and fails on any error. To see one project's errors: `cd packages/<name> && bunx tsc --noEmit -p tsconfig.json`. ecs-talk and mua also typecheck the ecs and helpers source they import, so an error there shows under several projects.
