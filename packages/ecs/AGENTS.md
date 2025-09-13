# Repository Guidelines

## Project Structure & Module Organization
- `packages/ecs`: TypeScript ECS library. Tests in `src/__test__`. See `packages/ecs/SQLITE_WASM_SETUP.md` for SQLite WASM.
- `packages/helpers`: Shared utilities (`log`, `string`, `try-catch`).
- `packages/tank-world`: Vite + React app and a Bun server in `src/server`. Tests in `src/**/__test__`.
- `docs`: Design and integration notes.

## Build, Test, and Development Commands
- Prereqs: Bun 1.1+ and Node 20+. Install once at repo root: `bun install`.
- ECS
  - `cd packages/ecs && bun test`: Run Bun tests.
  - `bun run test:coverage`: Coverage for ECS.
  - `bun run lint` | `bun run format`: Lint/format.
- Tank World
  - `cd packages/tank-world && bun run dev`: Vite dev server.
  - `bun run dev:server` | `bun run start:server`: Bun game server (dev/prod).
  - `bun run test` | `bun run coverage`: Vitest / coverage.
  - `bun run lint` | `bun run format`: Lint/format.
- Workspace utilities: `bunx npm-check-updates --interactive` to review dependency updates.

## Coding Style & Naming Conventions
- Language: TypeScript ESM; prefer `type` aliases over interfaces.
- Functions: Arrow functions; `prefer-const`; no `var`.
- Imports: Sorted (Prettier + sort-imports); use type-only imports when applicable.
- Formatting: 2-space indent, semicolons on, trailing commas per Prettier.
- Files: TS modules kebab-case (e.g., `game-loop.ts`); React components PascalCase (e.g., `SQLiteDemo.tsx`).
- Naming: camelCase (vars/functions), PascalCase (types/enums), UPPER_SNAKE_CASE (constants).

## Testing Guidelines
- Frameworks: Bun test (ECS) and Vitest (Tank World).
- Location: colocate under `src/__test__` with `*.test.ts`/`*.test.tsx`.
- Coverage: Maintain or improve; aim for 80%+.
- Mocks: Prefer lightweight fakes; keep tests deterministic.
- ECS query tips: `queryEntity` returns snapshots; use `{ asProxy: true }` to enable add/remove via assignment and always `world.flush()` to persist.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`) per history.
- PRs: Clear description, rationale, and scope; link issues. Include screenshots for UI changes and failing/updated tests for logic changes.
- Monorepo etiquette: Limit changes to one package per PR when possible; update affected package `CHANGELOG` if maintained.

## Security & Configuration Tips
- Use environment variables; do not commit `.env`.
- SQLite WASM setup: see `packages/ecs/SQLITE_WASM_SETUP.md`.
- Lint/format must pass before merge; CI may enforce.

