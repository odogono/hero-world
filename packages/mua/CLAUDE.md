# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MUA is a TypeScript project built with Bun runtime that provides both a WebSocket echo server and a terminal UI (TUI) application. The project demonstrates dual interface patterns using modern TypeScript tooling and the OpenTUI library for terminal interfaces.

## Commands

### Development

- `bun run server` - Start the WebSocket echo server with hot reload at port 3000
- `bun run tui` - Start the terminal UI application with hot reload
- `bun run index.ts` - Run the basic hello world entry point

### Code Quality

- `bun test` - Run tests using Bun's built-in test runner
- `bun run test:coverage` - Run tests with coverage reporting
- `bun run lint` - Check for linting errors using ESLint
- `bun run lint:fix` - Auto-fix linting errors
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check code formatting without making changes
- `bun run unused` - Find unused code with knip

### Maintenance

- `bun run outdated` - Interactive dependency update tool using npm-check-updates

## Architecture

### Dual Interface Pattern

The project implements two distinct interface patterns:

1. **Server Interface** (`src/server/index.ts`) - Elysia-based WebSocket echo server
2. **Terminal Interface** (`src/tui/index.tsx`) - React-like TUI using OpenTUI

### Dependencies Architecture

- **Runtime**: Built on Bun runtime with TypeScript support
- **Workspace Dependencies**: Uses `odgn-ecs` and `odgn-helpers` from the Hero World monorepo
- **Server**: Elysia framework for WebSocket and HTTP handling
- **TUI**: OpenTUI (React-like) for terminal user interfaces with advanced styling

### TypeScript Configuration

- Extends root monorepo TypeScript configuration
- Custom JSX import source set to `@opentui/react` for TUI components
- Path aliases configured:
  - `@/*` - Maps to `./src/*`
  - `@server/*` - Maps to `./src/server/*`
  - `@tui/*` - Maps to `./src/tui/*`

## Development Guidelines

### Bun Runtime Requirements

- Use `bun` commands instead of `node`, `npm`, `yarn`, or `pnpm`
- Use `bun:sqlite` for database operations if needed
- Use `Bun.serve()` for HTTP/WebSocket servers instead of Express
- Use built-in WebSocket support instead of external libraries
- Prefer `Bun.file` over Node.js `fs` operations

### Code Style

- ESLint configuration extends `@nkzw/eslint-config` with custom rules
- Enforces TypeScript type definitions over interfaces
- Prefers arrow functions and const declarations
- React unknown properties are allowed for TUI components
- Import resolution for workspace dependencies configured

### TUI Development Patterns

- Use OpenTUI React-like components (`<box>`, `<input>`, `<scrollbox>`)
- Implement keyboard handlers with `useKeyboard` hook
- Use `useRenderer` for console visibility controls
- Style components with inline style objects for colors and layouts
- ESC key typically used for application exit
- TAB key commonly used for toggling console visibility

### Server Development Patterns

- Use Elysia framework for WebSocket and HTTP endpoints
- Implement WebSocket handlers: `message`, `open`, `close`
- Use `odgn-helpers/log` for structured logging
- Default port 3000 for server applications
- Echo pattern commonly used for WebSocket message handling

### Testing Structure

- Use Bun's built-in test functions: `import { test, expect } from "bun:test"`
- Test files should follow the pattern `*.test.ts`
- Coverage reporting available through `bun run test:coverage`
