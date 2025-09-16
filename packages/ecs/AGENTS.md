# Repository Guidelines

## Project Structure & Module Organization

- `packages/ecs`: TypeScript ECS library. Tests in `src/__test__`.
- `packages/helpers`: Shared utilities (`log`, `string`, `try-catch`).
- `packages/tank-world`: Vite + React app and Bun game server (`src/server`). Tests in `src/**/__test__`.
- `docs`: Design and integration notes. Root is a Bun/TypeScript workspace.

## Build, Test, and Development Commands

- Install deps once at root: `bun install` (Bun 1.1+, Node 20+).
- ECS: `cd packages/ecs && bun test` (Bun tests), `bun run test:coverage`, `bun run lint`, `bun run format`.
- Tank World app: `cd packages/tank-world && bun run dev` (Vite). Server: `bun run dev:server` (dev) | `bun run start:server` (prod).
- Tank World tests: `bun run test`, coverage: `bun run coverage`, lint/format: `bun run lint` | `bun run format`.
- Workspace utilities: `bunx npm-check-updates --interactive` to review updates.

## Coding Style & Naming Conventions

- Language: TypeScript ESM; prefer `type` aliases over interfaces.
- Functions: Arrow functions; `prefer-const`; no `var`.
- Imports: Sorted (Prettier + sort-imports); use type-only imports when possible.
- Formatting: 2-space indent, semicolons on, trailing commas (Prettier).
- Files: TS modules kebab-case (e.g., `game-loop.ts`); React components PascalCase (e.g., `SQLiteDemo.tsx`).
- Naming: camelCase (vars/functions), PascalCase (types/enums), UPPER_SNAKE_CASE (constants).

## Testing Guidelines

- Frameworks: Bun test (ECS) and Vitest (Tank World).
- Location: colocate under `src/__test__` with `*.test.ts(x)`.
- Coverage: maintain or improve; aim for 80%+.
- Determinism: prefer lightweight fakes; avoid brittle globals.

## ECS Query Tips

- `queryEntity` returns snapshots by default; assign/remove won’t persist.
- Use `queryEntity(world, { asProxy: true, with: [...] })` to enable add/remove via assignment, then call `world.flush()` to persist.

## Commit & Pull Request Guidelines

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`) per history.
- PRs: clear scope and rationale; link issues. Include screenshots for UI changes and failing/updated tests for logic changes.
- Monorepo etiquette: limit changes to one package per PR when possible; update package `CHANGELOG` if maintained.

## Security & Configuration Tips

- Use environment variables; do not commit `.env`.
- SQLite WASM setup for ECS: see `packages/ecs/SQLITE_WASM_SETUP.md`.
- Lint/format must pass before merge; CI may enforce.
