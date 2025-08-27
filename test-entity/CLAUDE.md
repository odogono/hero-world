# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Entity Component System (ECS) library built with TypeScript and Bun, featuring dual implementations:
1. **In-memory ECS** (`src/entity/`, `src/world.ts`) - Simple Maps-based approach  
2. **SQLite-backed ECS** (`src/sqlite/`) - Database-persistent with schema generation

The SQLite implementation uses Zod schemas to automatically generate database tables and provides type-safe components with change tracking.

## Common Commands

### Development
- `bun install` - Install dependencies
- `bun run index.ts` - Run main file  
- `bun test` - Run all tests
- `bun test --coverage` - Run tests with coverage
- `bun test src/path/to/specific.test.ts` - Run specific test file

### Code Quality  
- `bun run lint` - Check for linting errors
- `bun run lint:fix` - Auto-fix linting errors
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check formatting
- `bun run unused` - Find unused code with knip

## Architecture

### Entity Component System (ECS) Pattern
- **Entity**: Unique numeric identifier (`type Entity = number` or `{ id: number, world: World }`)
- **Component**: Data containers (Location, Stats, HitPoints, etc.)  
- **World**: Container managing entities, components, and their relationships

### Dual Implementations

#### In-Memory ECS (`src/entity/`, `src/world.ts`)
```ts
const world = createWorld();
const entity = createEntity(world);
const location = createLocation(world, { name: "Forest", region: "North" });
setEntityLocation(world, entity, location);
```

#### SQLite ECS (`src/sqlite/`)
```ts
const world = createWorld(); // Creates in-memory SQLite DB
const entity = createEntity(world, { location: { name: "Forest", region: "North" } });
flush(world); // Persist changes to database
saveWorld(world, "game.db"); // Save to file
```

### SQLite ECS Key Features

#### Schema Generation
- Zod schemas automatically generate SQLite tables via `zodSchemaToSqliteTable`
- Component definitions registered with `registerComponentDef`
- Foreign key relationships and constraints handled automatically

#### Change Tracking
- Components wrapped in Proxy objects track modifications
- `dirtyEntities` Map tracks which entities need database updates
- `flush()` persists all pending changes in a transaction

#### Component Management
- `addComponent(entity, componentName, data)` - Add component to entity
- `removeComponent(entity, componentName)` - Remove component from entity  
- `queryEntities(world, components, entity?)` - Query entities with specific components

### Path Aliases (tsconfig.json)
- `@/*` → `./src/*`
- `@entity` → `./src/entity` 
- `@entity/*` → `./src/entity/*`
- `@helpers/*` → `./src/helpers/*`
- `@types` → `./src/types`

## Key Files

### Core ECS Files
- `src/sqlite/world.ts` - Main SQLite ECS implementation
- `src/sqlite/types.ts` - Entity and Component type definitions
- `src/sqlite/component.ts` - Component proxy tracking system
- `src/sqlite/schema-to-sql.ts` - Zod schema to SQLite conversion

### Utility Files  
- `src/helpers/string.ts` - String utilities (camelCase, snake_case conversion)
- `src/helpers/trycatch.ts` - Error handling utilities
- `src/helpers/log.ts` - Logging utilities

## Development Guidelines

### Bun Runtime
- Use `bun:sqlite` for database operations (already configured)
- Use `bun test` for testing with built-in expect/test functions
- Prefer `Bun.file` over Node.js fs operations

### Component Creation Pattern
```ts
// Define Zod schema with metadata
export const componentSchema = z.object({
  id: z.int().optional().meta({ primaryKey: true, autoIncrement: true }),
  eid: z.int().optional().meta({ foreignKey: 'tbl_entity', cascade: true }),
  name: z.string(),
  // ... other fields
}).meta({ name: 'tbl_component_name', id: '/component-url' });

// Register component definition  
world = registerComponentDef(world, componentSchema, {
  // Custom SQL statements
  selectByName: 'SELECT * FROM tbl_component_name WHERE name = ?1'
});
```

### Testing Structure
- Test files in `src/**/__test__/*.test.ts`
- Use `import { test, expect } from "bun:test"`
- Entity and component tests in `src/__test__/entity.test.ts` and `src/sqlite/__test__/entity.test.ts`
- SQLite functionality tests in `src/sqlite/__test__/`

## Key Implementation Details

### Component Field Naming
- Component schemas use camelCase field names (e.g., `firstName`, `lastName`)
- Database columns are automatically converted to snake_case (e.g., `first_name`, `last_name`)
- The system automatically converts between formats during database operations

### Type Safety
- `Components` type in `src/sqlite/types.ts` must include all component types for proper TypeScript inference
- `Entity<C>` uses `-?: NonNullable<Components[K]>` to ensure required components are not undefined
- `createEntity` function overloads enable automatic type inference from `initialComponents`
