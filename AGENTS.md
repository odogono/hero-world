# Repository Guidelines

## Project Structure & Module Organization
- packages/ecs: TypeScript ECS library, tests in `src/__test__`.
- packages/helpers: Shared helpers (TS). Exports `log`, `string`, `try-catch` utilities.
- packages/tank-world: Vite + React app and a Bun server (`src/server`). Tests in `src/**/__test__` and Vitest setup.
- docs: Design and integration notes. Root is a Bun/TypeScript workspace.

## Build, Test, and Development Commands
- ECS
  - `cd packages/ecs && bun test`: Run Bun tests.
  - `bun run test:coverage`: Coverage for ECS.
  - `bun run lint` | `bun run format`: Lint/format.
- Tank World
  - `cd packages/tank-world && bun run dev`: Vite dev server.
  - `bun run dev:server` | `bun run start:server`: Bun game server (dev/prod).
  - `bun run test` | `bun run coverage`: Run Vitest / coverage.
  - `bun run lint` | `bun run format`: Lint/format.
- Workspace utilities
  - `bunx npm-check-updates --interactive`: Review dependency updates.

Prereqs: Bun 1.1+, Node 20+, pnpm/npm compatible workspaces. Install once at repo root with `bun install`.

## Coding Style & Naming Conventions
- Language: TypeScript ESM. Prefer type aliases (`type`) over interfaces.
- Functions: Arrow functions; `prefer-const`; no `var`.
- Imports: Sorted (Prettier + sort-imports). Use type-only imports where applicable.
- Indentation: 2 spaces, semicolons on, trailing commas per Prettier.
- Files: TS modules kebab-case (e.g., `game-loop.ts`); React components PascalCase (e.g., `SQLiteDemo.tsx`).
- Naming: camelCase for vars/functions, PascalCase for types/enums, UPPER_SNAKE_CASE for constants.

## Testing Guidelines
- Frameworks: Bun test (ECS), Vitest (Tank World).
- Location: colocate under `src/__test__` with `*.test.ts(x)`.
- Coverage: Keep or improve existing coverage; aim for 80%+ where feasible.
- Mocks: Prefer lightweight fakes over heavy globals; keep tests deterministic.

## ECS Query Tips
- Snapshots: `queryEntity` returns a snapshot by default; assignment won’t add/remove components.
- Proxy opt-in: Use `queryEntity(world, { asProxy: true, with: [...] })` to enable add/remove via assignment; always `world.flush()` to persist.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`) as used in history.
- PRs: Clear description, rationale, and scope. Link issues. Include screenshots for UI changes and failing/updated tests for logic changes.
- Monorepo etiquette: Limit changes to one package per PR when possible; update affected package `CHANGELOG` if maintained.

## Security & Configuration Tips
- Secrets: Use environment variables; do not commit `.env`.
- SQLite WASM: See `packages/ecs/SQLITE_WASM_SETUP.md` for local setup.
- Lint/format must pass before merge; CI may enforce.
