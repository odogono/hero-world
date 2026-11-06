# Hero World — Agent Guidelines

Game libraries and the games built on them: Elixir (Mix) packages, and a Bun workspace for the TypeScript ones. Package `AGENTS.md` files override this one inside their trees.

## Repo layout

- `packages/mua_world`: the mua text adventure's World, in Elixir: gameplay, NorthTalk Scripts and the EDL content. See `packages/mua_world/AGENTS.md`.
- `packages/mua_server`: the Phoenix server a browser plays through. See `packages/mua_server/AGENTS.md`.
- `packages/mua_client`: the Preact browser client, and the `bun run load` load test.
- `packages/odgn_ecs`, `packages/odgn_edl`, `packages/odgn_ecs_talk`: the Elixir ECS, EDL loader and NorthTalk Host Adapter that `mua_world` is built on.
- `packages/ecs` (`odgn-ecs`): the TypeScript ECS, kept at parity with the Elixir libraries for the browser (ADR 0019). See `packages/ecs/AGENTS.md`.
- `packages/ecs-talk`: the TypeScript twin of `odgn_ecs_talk`, on `@northtalk/ts` published from the commit every `mix.exs` pins (`bun run check:northtalk`, ADR 0021).
- `packages/ecs-engine`: the TypeScript twin of `odgn_ecs_engine` (ADR 0021). Both run the Step cases in `spec/ecs/steps/`.
- `packages/mua-local`: a Local World: the main World in a Web Worker with sqlite-wasm in OPFS, for offline play (ADR 0023).
- `packages/helpers` (`odgn-helpers`): logging, strings, `trycatch`.
- `tools/`: commit, changelog and typecheck scripts.
- `GLOSSARY.md` and `docs/adr/`: domain terms and decisions (`docs/agents/domain.md`).

## Sources outside this repo

- **NorthTalk** (the Script language behind `odgn_ecs_talk`): the spec is `~/work/odgn/odgn-talk/spec/` (embedding: `09-embedding.md`) and the TypeScript host guide is `~/work/odgn/odgn-talk/docs/embedding-typescript.md`. For the Elixir Host, start from `impl/elixir/NAVIGATION.md`; the `north_talk` dep in each `mix.exs` pins its commit, and `deps/north_talk/` holds that copy. Not checked out? Read the same paths from `odogono/odgn-talk` on GitHub with `gh api`.
- **Ogalala** (the 1990s Java MUD that `mua` borrows from): `~/work/odgn/ogalala`. Start from `packages/mua_world/docs/ogalala-patterns.md`; its own `docs/` are wrong in places.

## Workflow

- Install: `bun install` at the root, which also turns on the git hooks in `.githooks/`. The hooks install it themselves in a fresh worktree.
- Elixir packages: `mix deps.get`, `mix test`, `mix format` from the package directory.
- Everything CI runs: `bun run check` (`docs/agents/checks.md`).
- Commit subjects and changelog fragments: `docs/agents/commits.md`.
- Package scripts (`test`, `lint`, `format`) live in each `package.json`; run them from the package directory.
- Issues: GitHub Issues on `odogono/hero-world` (`docs/agents/issue-tracker.md`, labels in `docs/agents/triage-labels.md`).

## Conventions

- In TypeScript, use Bun throughout: `bun`, `bunx`, `bun:test`, `bun:sqlite`, `Bun.file`, `Bun.serve`.
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- For a lightweight Result, use `trycatch` from `odgn-helpers/try-catch`, which returns `[data, error]`.
- Tests sit in `src/**/__test__/*.test.ts(x)` and use `bun:test`.
- ECS changes and flush: `packages/ecs/docs/api.md`.
- Keep a change to one package when you can.
