# Hero World — Agent Guidelines

This file is for agentic coding tools (Codex/Claude/Cursor/etc.) working in this repo.

## Scope & precedence

- This root `AGENTS.md` applies repo-wide by default.
- More specific files override it within their directory trees:
  - `packages/ecs/AGENTS.md`
  - `packages/tank-world/AGENTS.md`
  - `packages/mua/AGENTS.md`

## Cursor rules (found in `.cursor/rules/`)

- Prefer **Bun** commands and APIs:
  - Use `bun`, not `node`/`npm`/`yarn`/`pnpm`.
  - For Vite, use `bunx --bun vite` (already wired in scripts).
  - Prefer `Bun.file(...)` over Node `fs` for simple file reads.
  - Prefer `Bun.serve(...)` for HTTP/WebSocket servers where applicable.
  - Prefer `bun:sqlite` for SQLite access.

## Copilot rules

- No `.github/copilot-instructions.md` found in this repo.

## Repo layout

- `packages/ecs`: ECS + persistence/event system (TypeScript, Bun).
- `packages/helpers`: shared utilities (logging/string/trycatch/etc.).
- `packages/tank-world`: Vite + React client + Bun server (`src/server`).
- `packages/mua`: server + TUI app.
- `docs/`: design notes.

## Setup

- Install dependencies (workspace): `bun install`
- TypeScript is configured at root: `tsconfig.json` (strict, `noEmit`).

## Commands (build/lint/test)

### Root

- Install: `bun install`
- Check outdated deps: `bun run outdated`
- Typecheck (ad-hoc): `bunx tsc -p tsconfig.json --noEmit`

### `packages/ecs`

Run from `packages/ecs` unless stated.

- Tests: `bun test`
- Single test file: `bun test src/__test__/world.test.ts`
- Single test by name: `bun test -t "proxy"`
- Coverage: `bun run coverage` or `bun run test:coverage`
- Lint: `bun run lint` (fix: `bun run lint:fix`)
- Lint one file: `bun run lint -- src/world/index.ts`
- Format: `bun run format` (check: `bun run format:check`)
- Format one file: `bun run format -- src/world/index.ts`
- Generators: `bun run generate` / `bun run generate:edl` / `bun run generate:cdef`

### `packages/tank-world`

Run from `packages/tank-world` unless stated.

- Dev (client): `bun run dev` (Vite)
- Build (client): `bun run build`
- Preview: `bun run preview`
- Dev server (Bun): `bun run dev:server`
- Prod server (Bun): `bun run start:server`
- Unit tests: `bun run test`
- Single test file: `bun test src/server/game/__test__/world.test.ts`
- Single test by name: `bun test -t "should"`
- Coverage: `bun run coverage`
- Lint: `bun run lint` (fix: `bun run lint:fix`)
- Format: `bun run format` (check: `bun run format:check`)
- E2E tests: `bun run test:e2e`
  - Install browsers once: `bunx playwright install`
  - Filter: `bun run test:e2e -- -g "login"`

### `packages/mua`

Run from `packages/mua` unless stated.

- Dev server: `bun run server`
- TUI (hot): `bun run tui`
- Tests: `bun test` (single file: `bun test src/server/__test__/server.test.ts`)
- Coverage: `bun run test:coverage`
- Lint/format: `bun run lint` / `bun run format`

### `packages/helpers`

- No package scripts; tests exist under `packages/helpers/src/__test__`.
- Prefer writing new tests using `bun:test` to match the rest of the repo.
- Run helper tests via Bun (ad-hoc):
  - `bun test packages/helpers/src/__test__/string.test.ts`
- Note: there is at least one test using `vitest` imports.
  - If needed, run Vitest directly: `bunx vitest packages/helpers/src/__test__/password.test.ts`

## Code style (enforced by Prettier + ESLint)

### Language & modules

- TypeScript ESM (`"type": "module"`); keep code ESM-friendly.
- Prefer `type` aliases over `interface` (enforced by ESLint).
- Keep TS strictness in mind (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).

### Formatting (Prettier)

Configured in package `.prettierrc` files.

- 2 spaces, `semi: true`, `singleQuote: true`, `printWidth: 80`.
- `trailingComma: "none"`.
- `arrowParens: "avoid"`, `endOfLine: "lf"`.
- In `packages/tank-world`, Tailwind classes are sorted via `prettier-plugin-tailwindcss`.

### Imports

- Imports are auto-sorted via `@ianvs/prettier-plugin-sort-imports`.
- Import order (high level):
  1. `react`
  2. third-party
  3. workspace/alias imports (e.g. `odgn-ecs/*`, `odgn-helpers/*`, `@...`)
  4. relative (`./`, `../`)
- Use type-only imports when possible: `import type { Foo } from '...'`.

### Naming & files

- Variables/functions: `camelCase`.
- Types/enums: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE`.
- Files:
  - TS modules: `kebab-case` (e.g. `game-loop.ts`).
  - React components: `PascalCase` (e.g. `SQLiteDemo.tsx`).

### Functions

- Prefer function expressions / arrow functions (ESLint `func-style: expression`).
- Prefer `const`; never use `var`.

### Error handling

- Prefer explicit error handling over swallowing errors.
- When you need a lightweight Result pattern, use `trycatch` from `odgn-helpers/try-catch` which returns `[data, error]`.
- Convert `unknown` errors to `Error` before logging/returning (the helper already does this).

### Linting expectations

- ESLint uses `@nkzw/eslint-config` plus project rules.
- Don’t fight the linter/formatter; run `bun run lint:fix` and `bun run format`.

## Testing guidelines

- Tests are colocated under `src/**/__test__` and named `*.test.ts(x)`.
- Use `bun:test` APIs for new tests unless the package already uses another runner.
- Keep tests deterministic; avoid relying on global/shared state.

## Domain-specific notes

- ECS entity queries: `queryEntity` returns snapshots by default.
  - If you need assignment-based mutations, use `queryEntity(world, { asProxy: true, ... })` and then `world.flush()`.
- Tank-world uses SQLite WASM; keep COOP/COEP headers in mind for SharedArrayBuffer.

## Hygiene & security

- Don’t commit secrets (`.env`, credentials) or generated artifacts (DB files, coverage output).
- Keep changes focused to one package when possible in this monorepo.
