# Repository Guidelines

## Project Structure & Module Organization
- Monorepo (Bun/TypeScript):
  - `packages/ecs`: TypeScript ECS library; tests in `src/__test__`.
  - `packages/helpers`: Shared helpers (`log`, `string`, `try-catch`).
  - `packages/tank-world`: Vite + React app and Bun server (`src/server`); tests in `src/**/__test__`.
  - `docs/`: Design and integration notes.
- Tank World app code lives under `src/` (`components/`, `contexts/`, `helpers/`, `hooks/`, `screens/`, `types.ts`). Entry: `main.tsx`, styles: `index.css`, shell: `index.html`. Config: `vite.config.js`, `vitest.config.ts`.

## Build, Test, and Development Commands
- Install once at root: `bun install`.
- ECS:
  - `cd packages/ecs && bun test` (Bun tests) | `bun run test:coverage`.
  - `bun run lint` | `bun run format`.
- Tank World:
  - `cd packages/tank-world && bun run dev` (Vite dev, http://localhost:5173).
  - `bun run build` | `bun run preview`.
  - `bun run dev:server` | `bun run start:server` (Bun server).
  - `bun run test` (Bun test) | `bun run coverage` | `bun run lint` | `bun run format`.
  - E2E: `bun run test:e2e` (Playwright; start dev server first).
- Workspace utilities: `bunx npm-check-updates --interactive`.

## Coding Style & Naming Conventions
- TypeScript ESM; 2-space indent; semicolons; single quotes; trailing commas per Prettier.
- Prefer arrow functions; `prefer-const`; no `var`.
- Types: use `type` aliases over `interface`.
- Imports: sorted; use type-only imports where applicable.
- Files: TS modules kebab-case (e.g., `game-loop.ts`); React components PascalCase (e.g., `SQLiteDemo.tsx`).
- Naming: camelCase (vars/functions), PascalCase (types/enums), UPPER_SNAKE_CASE (constants).

## Testing Guidelines
- Framework: Bun test for ECS and Tank World; Playwright for E2E.
- Location: colocate under `src/**/__test__` with `*.test.ts(x)` or `*.spec.ts(x)`.
- Coverage: keep or improve; target ≥80%.
- Deterministic tests; prefer lightweight fakes over globals.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat:`, `fix:`, `chore:`).
- Before PR: `bun run lint && bun run format:check && bun run test` (root/package).
- PRs: clear description, rationale, scope; link issues. Include screenshots for UI changes and failing/updated tests for logic changes. Limit to one package when possible; update affected package `CHANGELOG` if maintained.

## Security & Configuration Tips
- Use environment variables; never commit `.env`.
- SQLite WASM needs COOP/COEP; local dev is set in `vite.config.js`—ensure equivalent headers in production.
- Keep Vite and Vitest aliases in sync.
 - WebSocket URL can be overridden via `VITE_WS_URL` (e.g., `VITE_WS_URL=ws://127.0.0.1:3001/ws bun run dev`). The client will also try fallbacks: current origin and then `ws://127.0.0.1:3001/ws`.
