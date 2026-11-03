# Hero World — Agent Guidelines

A Bun workspace of game libraries and the games built on them. Package `AGENTS.md` files override this one inside their trees.

## Repo layout

- `packages/ecs` (`odgn-ecs`): SQLite-backed ECS, EDL world files, events, game loop. See `packages/ecs/AGENTS.md`.
- `packages/mua_world`: the mua text adventure's World, in Elixir: gameplay, NorthTalk Scripts and the EDL content. See `packages/mua_world/README.md`.
- `packages/mua_server`: the Phoenix server a browser plays through. See `packages/mua_server/README.md`.
- `packages/mua_client`: the Preact browser client.
- `packages/odgn_ecs`, `packages/odgn_edl`, `packages/odgn_ecs_talk`: the Elixir ECS, EDL loader and NorthTalk Host Adapter that `mua_world` is built on.
- `packages/helpers` (`odgn-helpers`): logging, strings, `trycatch`.
- `tools/`: commit, changelog and typecheck scripts.
- `GLOSSARY.md` and `docs/adr/`: domain terms and decisions (`docs/agents/domain.md`).

## Sources outside this repo

- **NorthTalk** (the Script language behind `odgn_ecs_talk`): the spec is `~/work/odgn/odgn-talk/spec/` (embedding: `09-embedding.md`) and the TypeScript host guide is `~/work/odgn/odgn-talk/docs/embedding-typescript.md`. Read these before the bundled `.d.ts` files. Not checked out? Read the same paths from `odogono/odgn-talk` on GitHub with `gh api`.
- **Ogalala** (the 1990s Java MUD that `mua` borrows from): `~/work/odgn/ogalala`. Start from `packages/mua_world/docs/ogalala-patterns.md`; its own `docs/` are wrong in places.

## Workflow

- Install: `bun install` at the root, which also turns on the git hooks in `.githooks/`.
- Everything CI runs: `bun run check` (`docs/agents/checks.md`).
- Commit subjects and changelog fragments: `docs/agents/commits.md`.
- Package scripts (`test`, `lint`, `format`) live in each `package.json`; run them from the package directory.
- Issues: GitHub Issues on `odogono/hero-world` (`docs/agents/issue-tracker.md`, labels in `docs/agents/triage-labels.md`).

## Conventions

- Use Bun throughout: `bun`, `bunx`, `bun:test`, `bun:sqlite`, `Bun.file`, `Bun.serve`.
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- For a lightweight Result, use `trycatch` from `odgn-helpers/try-catch`, which returns `[data, error]`.
- Tests sit in `src/**/__test__/*.test.ts(x)` and use `bun:test`.
- ECS changes and flush: `packages/ecs/docs/api.md`.
- Keep a change to one package when you can.
