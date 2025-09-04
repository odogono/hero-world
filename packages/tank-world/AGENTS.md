# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript React app code.
  - `components/`, `contexts/`, `helpers/`, `hooks/`, `screens/`, `types.ts`.
  - Entry: `main.tsx`; styles: `index.css`.
- `index.html`: App shell (Vite).
- `vite.config.js` and `vitest.config.ts`: Aliases like `@components`, `@helpers`, etc.
- Build output: `dist/` (Vite default).

## Build, Test, and Development Commands
- `bun run dev`: Start Vite dev server on `http://localhost:5173`.
- `bun run build`: Production build to `dist/`.
- `bun run preview`: Serve the production build locally.
- `bun run test`: Run unit tests with Vitest.
- `bun run coverage`: Run tests with coverage (V8; reports text/json/html).
- `bun run lint` / `bun run lint:fix`: Lint code; autofix common issues.
- `bun run format` / `bun run format:check`: Prettier formatting.
- Optional E2E debug: `node test-app.js` (uses Playwright; start dev server first).

## Coding Style & Naming Conventions
- Language: TypeScript + React; 2‑space indent, single quotes, semicolons.
- Prefer arrow functions; `prefer-const`; no `var`.
- Type style: use `type` aliases (enforced by ESLint).
- Imports: use configured aliases (e.g., `@components/Button`); sorted via Prettier plugin.
- Tailwind: utility classes allowed; plugin auto-sorts classes.

## Testing Guidelines
- Framework: Vitest (`environment: node`, `globals: true`).
- Coverage: collected for `src/**/*.ts`; view HTML at `coverage/index.html`.
- Test files: `*.test.ts` or `*.spec.ts(x)` near code.
- Focus unit tests on helpers/logic; mock React where practical.

## Commit & Pull Request Guidelines
- Prefer Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- PRs must include: concise description, linked issue (if any), screenshots for UI changes (e.g., update `app-screenshot.png` when relevant).
- Before opening a PR: `bun run lint && bun run format:check && bun run test`.

## Security & Configuration Tips
- SQLite WASM requires COOP/COEP headers; local dev is configured in `vite.config.js`. Ensure equivalent headers in production.
- Keep aliases in `vite.config.js` and `vitest.config.ts` in sync.
