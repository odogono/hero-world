# Repository Guidelines

## Project Structure & Module Organization
- Root Bun/TypeScript workspace with packages under `packages/` and shared notes in `docs`.
- `packages/ecs`: core ECS library; library code in `src`, tests in `src/__test__`, database setup notes in `SQLITE_WASM_SETUP.md`.
- `packages/helpers`: shared utilities (`log`, `string`, `try-catch`).
- `packages/tank-world`: Vite + React client and Bun game server (`src/server`); colocated tests in `src/**/__test__`.

## Build, Test, and Development Commands
- Install dependencies once: `bun install` (run at repo root).
- ECS workflows from `packages/ecs`: `bun test`, `bun run test:coverage`, `bun run lint`, `bun run format`, `bun run generate`.
- Tank World app: `bun run dev` (client), `bun run dev:server` (server), `bun run start:server` (prod), `bun run test`, `bun run coverage`.
- Workspace utilities: `bunx npm-check-updates --interactive` to review dependency bumps.

## Coding Style & Naming Conventions
- TypeScript ESM with arrow functions and `type` aliases; no `var`.
- Prefer `const`, camelCase for variables/functions, PascalCase for types/enums, UPPER_SNAKE_CASE for constants.
- Files: kebab-case for modules (e.g., `game-loop.ts`), PascalCase for React components.
- Formatting: 2-space indent, semicolons, Prettier with sorted imports; run `bun run lint` and `bun run format:check` before committing.

## Testing Guidelines
- ECS uses Bun test runner (`bun test`); Tank World uses Vitest (`bun run test`).
- Keep tests adjacent to code under `src/**/__test__` with `*.test.ts` or `*.test.tsx` suffixes.
- Maintain ≥80% coverage; use `bun run test:coverage` or `bun run coverage`.
- Favor deterministic fakes over global state.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (e.g., `feat: add new query`, `fix: handle proxy persistence`).
- Before pushing: `bun run lint && bun run format:check && bun run test`.
- PRs should focus on one package when possible, explain rationale, link issues, and include relevant screenshots or test results.

## Security & Configuration Tips
- Use environment variables for secrets; keep `.env` files out of version control.
- SQLite configuration details live in `packages/ecs/SQLITE_WASM_SETUP.md`; reference when working on persistence layers.

## Agent Workflow Notes
- Prefer Bun-native APIs (`Bun.file`, `bun:sqlite`) and avoid Node-only globals.
- When modifying ECS entities, use `queryEntity(..., { asProxy: true })` and call `world.flush()` to persist changes.
