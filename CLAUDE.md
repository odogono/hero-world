# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hero World is a monorepo containing game development libraries built with TypeScript and Bun. The main components are:

- **odgn-ecs**: SQLite-backed Entity Component System with persistent event handling
- **odgn-helpers**: Shared utilities for string manipulation, error handling, and logging
- **tank-world**: React frontend game demo using Vite, Tailwind, and the ECS system

## Monorepo Structure

This is a Bun workspace with packages managed via `"workspaces": ["packages/*"]` in the root package.json:

```
packages/
├── ecs/        - Core ECS library (odgn-ecs)
├── helpers/    - Shared utilities (odgn-helpers) 
└── tank-world/ - React game demo
```

## Common Commands

### Root Level
- `bun install` - Install all workspace dependencies
- `bun run index.ts` - Run main entry point

### Package Level (run from within package directories)

#### ECS Package (`packages/ecs/`)
- `bun test` - Run ECS tests
- `bun run test:coverage` - Run tests with coverage
- `bun run lint` - Check for linting errors
- `bun run lint:fix` - Auto-fix linting errors
- `bun run format` - Format code with Prettier
- `bun run unused` - Find unused code with knip

#### Tank World Package (`packages/tank-world/`)
- `bun run dev` - Start development server (uses `bunx --bun vite`)
- `bun run build` - Build for production (uses `bunx --bun vite build`)
- `bun run dev:server` - Start backend server in development mode with hot reload
- `bun run start:server` - Start backend server in production mode
- `bun run test` - Run tests with Vitest
- `bun run coverage` - Run tests with coverage
- `bun run preview` - Preview production build
- `bun run lint` - Check for linting errors
- `bun run lint:fix` - Auto-fix linting errors
- `bun run format` - Format code with Prettier
- `bun run unused` - Find unused code with knip

#### Helpers Package (`packages/helpers/`)
- No specific scripts - uses shared utilities for string manipulation, error handling, and logging
- Contains dependencies: `github-slugger` for URL slug generation

## Architecture

### Workspace Dependencies

Cross-package dependencies are managed via workspace references:
- `"odgn-ecs": "workspace:*"`
- `"odgn-helpers": "workspace:*"`

### Path Mapping

TypeScript path mapping is configured at the root level in tsconfig.json:
```json
"paths": {
  "odgn-ecs/*": ["packages/ecs/src/*"],
  "odgn-helpers/*": ["packages/helpers/src/*"]
}
```

### ECS Library Architecture

The core ECS system (`packages/ecs/`) provides:

1. **SQLite-backed ECS**: Persistent entity-component storage with automatic schema generation from Zod schemas
2. **Event System**: Type-safe event publishing/subscribing with database persistence and scheduling
3. **Game Loop**: Priority-based system execution with performance tracking
4. **Change Tracking**: Proxy-based component modification detection

Key files:
- `src/world.ts` - World creation and SQLite ECS implementation
- `src/entity.ts` - Entity management functions
- `src/component.ts` - Component definitions and change tracking
- `src/events/` - Event system implementation
- `src/system/` - Game loop and system management

### Frontend Architecture

The tank-world demo (`packages/tank-world/`) demonstrates:
- React 19 with TypeScript and Vite
- Tailwind CSS v4 with PostCSS and Vite plugin (`@tailwindcss/vite`)
- Integration with the ECS system and SQLite WASM
- Theme context and components with dark/light mode toggle
- Vitest for testing with coverage support
- Elysia-based backend server with WebSocket support and REST API
- Cross-Origin-Embedder-Policy headers for SQLite WASM compatibility

## Development Guidelines

### Bun Runtime Requirements

- Use `bun` commands instead of `node`, `npm`, `yarn`, or `pnpm`
- Use `bun:sqlite` for database operations (configured in ECS package)
- Use `bun test` with built-in test/expect functions
- Use `bunx --bun vite` for Vite operations in tank-world

### TypeScript Configuration

- Strict mode enabled with additional safety checks
- `noUncheckedIndexedAccess` and `noImplicitOverride` enabled
- Module detection set to "force" with "bundler" resolution
- JSX configured for React

### Code Quality Tools

All packages use consistent tooling:
- ESLint with `@nkzw/eslint-config`
- Prettier with import sorting plugin
- Knip for unused code detection
- Vitest/Bun test for testing

### Package Development

When working on packages:
1. Changes to workspace dependencies require running `bun install` at the root
2. Each package has its own test suite and linting configuration
3. The ECS package includes extensive examples in the `examples/` directory
4. Database files (like `world.db`) are generated at runtime and should not be committed

### Component Creation Pattern (ECS)

```ts
const componentDef = defineComponent({
  name: 'stats' as const,
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  }
});

const world = createWorld()
  .registerComponent(componentDef)
  .build();
```

### Testing Structure

- ECS tests in `packages/ecs/src/**/__test__/*.test.ts`
- Helper tests in `packages/helpers/src/**/__test__/*.test.ts`
- Use `import { test, expect, describe } from "bun:test"` for ECS/helpers
- Use `vitest` APIs for tank-world React components

### Browser Testing with Playwright

Playwright is installed in the tank-world package for debugging browser issues:

```bash
# Install Playwright (already configured)
bun add -D playwright @playwright/test
bunx playwright install

# Use Playwright for debugging browser errors
node test-app.js  # Custom script for capturing browser errors
```

Key benefits of Playwright for development:
- **Runtime error capture**: See exact browser console errors and stack traces
- **Network monitoring**: Track failed imports and 404/500 errors
- **Visual verification**: Take screenshots to verify UI rendering
- **Real browser testing**: Test actual browser behavior vs. build-time errors

The `test-app.js` script demonstrates:
- Listening for console messages, page errors, and request failures
- Navigating to the dev server and capturing real-time issues
- Verifying React root mounting and page functionality
- Taking screenshots for visual debugging

This approach was crucial for identifying and fixing:
- TypeScript import issues with `import type` syntax
- Vite path alias configuration problems
- Runtime vs. build-time error differentiation

## Server Architecture

### Tank World Backend (`packages/tank-world/src/server/`)

The backend uses Elysia framework with:
- **REST API**: Routes grouped under `/api` with Zod validation
- **WebSocket**: Real-time communication at `/ws` endpoint with chat broadcasting
- **Health Check**: Simple `/health` endpoint for monitoring
- **CORS Headers**: Configured for SQLite WASM compatibility

Key server features:
- In-memory client connection tracking for WebSocket broadcasting
- Zod schema validation for API requests and WebSocket messages
- Proxy configuration in Vite for development (port 3001)
- Default port 3001 with environment override support

### Vite Configuration

Tank-world includes specialized Vite configuration:
- Path aliases for clean imports (`@/`, `@components/`, etc.)
- SQLite WASM optimization exclusions
- COOP/COEP headers for SharedArrayBuffer support
- WebSocket and API proxy to backend server