# ECS Package Agent Guidelines

## Build/Test Commands

- **Install**: `bun install` (root workspace)
- **Test all**: `bun test`
- **Test single**: `bun test src/path/to/file.test.ts`
- **Coverage**: `bun run test:coverage`
- **Lint**: `bun run lint` / `bun run lint:fix`
- **Format**: `bun run format` / `bun run format:check`
- **Generate schemas**: `bun run generate` / `just generate-schemas`
- **Unused code**: `bun run unused`

## Code Style Guidelines

- **Language**: TypeScript ESM with Bun runtime
- **Types**: Prefer `type` aliases over `interface`
- **Functions**: Arrow functions; `prefer-const`; no `var`
- **Imports**: Sorted with Prettier plugin; type-only imports when possible
- **Formatting**: 2-space indent, single quotes, semicolons, trailing commas none
- **Naming**: camelCase (vars/functions), PascalCase (types/enums), UPPER_SNAKE_CASE (constants)
- **Files**: kebab-case for TS modules, PascalCase for React components

## Cursor Rules

- Use `bun` commands instead of `node`, `npm`, `yarn`, `pnpm`
- Prefer `Bun.file` over Node.js `fs` operations
- Use `bun:sqlite` for database operations
- Use built-in Bun test framework with `*.test.ts` files

## Testing Guidelines

- **Framework**: Bun test with `*.test.ts` files
- **Location**: `src/**/__test__/*.test.ts`
- **Coverage**: Maintain ≥80%; run `bun run test:coverage`
- **Determinism**: Prefer lightweight fakes; avoid brittle globals

## ECS Architecture Notes

- **Query persistence**: `queryEntity` returns snapshots; use `{ asProxy: true }` + `world.flush()` for mutations
- **Component management**: Property assignment on proxy entities persists via `flush()`
- **Database backends**: Bun SQLite (primary), SQLite WASM (browser), AlaSQL (dev/testing)
- **Path aliases**: `@/*` → `./src/*`, `@component` → `./src/component`, etc.

## Commit Guidelines

- Use Conventional Commits: `feat:`, `fix:`, `chore:`
- Run `bun run lint && bun run format:check && bun run test` before commits
- Update `CHANGELOG` for user-facing changes
