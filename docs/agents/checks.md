# Checks

`bun run check` runs everything CI's `check` job runs: lint, format, the typecheck ratchet and the tests of `ecs`, `ecs-talk`, `mua` and `tools/`. The `pre-push` hook runs it after the commit checks in [commits.md](commits.md). `bun install` turns the hooks in [`.githooks/`](../../.githooks/) on.

`tank-world` is outside the check: it still uses the old `defineComponent({ name })` API and its tests fail. Run its scripts from `packages/tank-world` by hand.

## The typecheck ratchet

The repo predates strict typechecking, so `tsc` reports hundreds of errors. `bun run typecheck` ([`tools/typecheck/ratchet.ts`](../../tools/typecheck/ratchet.ts)) typechecks each project with its own `tsconfig.json` and compares the error count per file with [`tools/typecheck/baseline.json`](../../tools/typecheck/baseline.json). It fails when a file has more errors than its baseline, so a change adds none.

- To see a project's errors: `cd packages/<name> && bunx tsc --noEmit -p tsconfig.json`.
- When you fix errors, the check prints the files that improved; run `bun run typecheck:update` and commit the baseline so the count can't creep back up.
- Never raise a count with `typecheck:update` to get a red check through; fix the new error.
