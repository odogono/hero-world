# MUA Agent Guidelines

## Build/Test Commands

- **Dev server**: `bun run server` (WebSocket echo server, port 3000)
- **TUI app**: `bun run tui` (Terminal UI with hot reload)
- **Test all**: `bun test`
- **Test single**: `bun test <filename>.test.ts` (e.g., `bun test src/server/index.test.ts`)
- **Coverage**: `bun run test:coverage`
- **Lint**: `bun run lint` / `bun run lint:fix`
- **Format**: `bun run format` / `bun run format:check`

## Code Style Guidelines

- **Language**: TypeScript ESM with Bun runtime
- **Imports**: Sorted with Prettier plugin; type-only imports where applicable
- **Formatting**: 2-space indent, single quotes, semicolons, trailing commas none
- **Types**: Prefer `type` aliases over `interface`; strict mode enabled
- **Functions**: Arrow functions preferred; `prefer-const`; no `var`
- **Naming**: camelCase (vars/functions), PascalCase (types), UPPER_SNAKE_CASE (constants)
- **Files**: kebab-case for TS modules, PascalCase for React components
- **Error handling**: Use `odgn-helpers/trycatch` for consistent error management

## Cursor Rules

- Use `bun` commands instead of `node`, `npm`, `yarn`, `pnpm`
- Use `Bun.serve()` for HTTP/WebSocket servers
- Prefer `Bun.file` over Node.js `fs` operations
- Use built-in WebSocket support instead of external libraries
- Use `bun:sqlite` for database operations if needed

## Architecture Notes

- **Server**: Elysia framework for WebSocket/HTTP endpoints
- **TUI**: OpenTUI React-like components with JSX import source `@opentui/react`
- **Path aliases**: `@/*` → `./src/*`, `@server/*` → `./src/server/*`, `@tui/*` → `./src/tui/*`
- **Workspace deps**: Uses `odgn-ecs` and `odgn-helpers` from monorepo
- **Testing**: Bun's built-in test runner with `*.test.ts` files
