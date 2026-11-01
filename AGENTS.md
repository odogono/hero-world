# Hero World — Agent Guidelines

A Bun workspace of game libraries and the games built on them. Package `AGENTS.md` files override this one inside their trees.

## Repo layout

- `packages/ecs` (`odgn-ecs`): SQLite-backed ECS, EDL world files, events, game loop. See `packages/ecs/AGENTS.md`.
- `packages/ecs-talk`: NorthTalk Host Adapter that lets Scripts drive an `odgn-ecs` World. See `packages/ecs-talk/README.md`.
- `packages/mua`: text-adventure server (Elysia + `mua-world` ECS) and OpenTUI client. See `packages/mua/AGENTS.md`.
- `packages/helpers` (`odgn-helpers`): logging, strings, `trycatch`.
- `packages/tank-world`: Vite + React demo on an old `odgn-ecs` API; outside `bun run check`. See `packages/tank-world/AGENTS.md`.
- `tools/`: commit, changelog and typecheck-ratchet scripts.
- `GLOSSARY.md` and `docs/adr/`: domain terms and decisions (`docs/agents/domain.md`).

## Sources outside this repo

- **NorthTalk** (the Script language behind `ecs-talk` and `@northtalk/ts`): the spec is `~/work/odgn/odgn-talk/spec/` (embedding: `09-embedding.md`) and the TypeScript host guide is `~/work/odgn/odgn-talk/docs/embedding-typescript.md`. Read these before the bundled `.d.ts` files. Not checked out? Read the same paths from `odogono/odgn-talk` on GitHub with `gh api`.
- **Ogalala** (the 1990s Java MUD that `mua` borrows from): `~/work/odgn/ogalala`. Start from `packages/mua/docs/ogalala-patterns.md`; its own `docs/` are wrong in places.

## Workflow

- Install: `bun install` at the root, which also turns on the git hooks in `.githooks/`.
- Everything CI runs: `bun run check`. Typecheck is a per-file ratchet: `docs/agents/checks.md`.
- Commit subjects and changelog fragments: `docs/agents/commits.md`.
- Package scripts (`test`, `lint`, `format`) live in each `package.json`; run them from the package directory.
- Issues: GitHub Issues on `odogono/hero-world` (`docs/agents/issue-tracker.md`, labels in `docs/agents/triage-labels.md`).

## Conventions

- Use Bun throughout: `bun`, `bunx`, `bun:test`, `bun:sqlite`, `Bun.file`, `Bun.serve`.
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- For a lightweight Result, use `trycatch` from `odgn-helpers/try-catch`, which returns `[data, error]`.
- Tests sit in `src/**/__test__/*.test.ts(x)` and use `bun:test`.
- `queryEntity` returns snapshots. To mutate by assignment, pass `asProxy: true`, then call `world.flush()`.
- Keep a change to one package when you can.
