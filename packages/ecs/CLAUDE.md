# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Entity Component System (ECS) library built with TypeScript and Bun. The SQLite implementation uses Zod schemas to automatically generate database tables and provides type-safe components with change tracking. The library includes event systems, game loops, and persistent event storage for building game engines.

## Common Commands

### Development

- `bun install` - Install dependencies
- `bun run index.ts` - Run main file
- `bun test` - Run all tests
- `bun run test:coverage` - Run tests with coverage
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

### SQLite ECS Implementation

The core implementation provides a SQLite-backed ECS with type-safe components:

```ts
const world = (await createWorld())
  .registerComponent(locationComponent)
  .registerComponent(statsComponent)
  .build();

const entity = createEntity(world, {
  location: { name: 'Forest', region: 'North' },
  stats: { health: 100, level: 1, mana: 50 }
});

flush(world); // Persist changes to database
saveWorld(world, 'game.db'); // Save to file
```

### Multi-Database Support

The library supports multiple database backends:
- **Bun SQLite** (`DatabaseType.BUN`) - Primary, high-performance option using `bun:sqlite`
- **SQLite WASM** (`DatabaseType.WASM`) - Browser-compatible using `@sqlite.org/sqlite-wasm`
- **AlaSQL** (`DatabaseType.ALASQL`) - Alternative implementation for development/testing

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

- `createEntity(world, initialComponents?)` - Create entity with optional initial components
- `deleteEntity(entity)` - Remove entity and cascade delete components
- `queryEntities(world, options?)` - Query entities with specific components
- `queryEntity(world, options?)` - Query single entity (automatically adds `limit: 1`)
- `queryEntitiesIterator(world, options?)` - Memory-efficient iterator for large result sets

### Path Aliases (tsconfig.json)

- `@/*` → `./src/*`
- `@component` → `./src/component`
- `@db` → `./src/db`
- `@db/*` → `./src/db/*`
- `@entity` → `./src/entity`
- `@events` → `./src/events`
- `@events/*` → `./src/events/*`
- `@helpers/*` → `./src/helpers/*`
- `@schema` → `./src/schema`
- `@schema/*` → `./src/schema/*`
- `@system` → `./src/system/index.ts`
- `@system/*` → `./src/system/*`
- `@types` → `./src/types`
- `@world` → `./src/world`

## Key Files

### Core ECS Files

- `src/world.ts` - Main SQLite ECS implementation and world creation
- `src/types.ts` - Entity and Component type definitions
- `src/component.ts` - Component proxy tracking system and definitions
- `src/entity.ts` - Entity creation, deletion, and querying functions
- `src/system/index.ts` - System execution and management

### Database Abstraction

- `src/db/index.ts` - Unified database interface and factory functions
- `src/db/bun-sqlite.ts` - Bun SQLite implementation
- `src/db/sqlite-wasm.ts` - SQLite WASM implementation
- `src/db/alasql.ts` - AlaSQL implementation
- `src/db/helpers.ts` - Database utility functions

### Event System

- `src/events/index.ts` - Simple event system with database persistence
- `src/system/game-loop.ts` - Event-aware game loop with priority-based system execution

### Utility Files

- `src/helpers/convert-keys.ts` - Key conversion utilities (camelCase ↔ snake_case)
- `src/schema/schema-to-sql.ts` - Zod schema to SQLite conversion
- `src/schema/types.ts` - Schema and table generation type definitions

## Development Guidelines

### Bun Runtime Requirements

- Use `bun:sqlite` for database operations (configured in ECS package)
- Use `bun test` with built-in test/expect functions
- Prefer `Bun.file` over Node.js fs operations
- Use `bun` commands instead of `node`, `npm`, `yarn`, or `pnpm`

### Component Creation Pattern

```ts
// Define component using defineComponent helper
const statsComponent = defineComponent({
  name: 'stats' as const,
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  },
  statements: {
    statsByLevel: 'SELECT * FROM tbl_stats WHERE level = ?1'
  }
});

// Register component with world using builder pattern
const world = (await createWorld()).registerComponent(statsComponent).build();
```

### Testing Structure

- Test files in `src/**/__test__/*.test.ts`
- Use `import { test, expect, describe } from "bun:test"`
- Main tests in `src/__test__/`: `entity.test.ts`, `component.test.ts`, `query.test.ts`, `system.test.ts`
- Database tests in `src/db/__test__/`: `alasql.test.ts`, `json-functions.test.ts`
- Schema tests in `src/schema/__test__/`: `schema-to-sql.test.ts`

## Key Implementation Details

### Component Field Naming

- Component schemas use camelCase field names (e.g., `firstName`, `lastName`)
- Database columns are automatically converted to snake_case (e.g., `first_name`, `last_name`)
- The system automatically converts between formats during database operations

### Type Safety

- `Components` type in `src/types.ts` must include all component types for proper TypeScript inference
- `Entity<C>` uses `-?: NonNullable<Components[K]>` to ensure required components are not undefined
- `createEntity` function overloads enable automatic type inference from `initialComponents`
- `WorldBuilder` provides type-safe component registration with automatic type accumulation

### System Architecture

Systems are functions that operate on world state:

```ts
// Create a system that processes entities
const movementSystem = createSystem(
  (entity, world, deltaTime, events) => {
    // Process entity movement
    if (entity.position && entity.velocity) {
      entity.position.x += entity.velocity.x * deltaTime;
      entity.position.y += entity.velocity.y * deltaTime;
    }
  },
  { with: ['position', 'velocity'] } // Query options
);

// Add to game loop
const gameLoop = createGameLoop(world);
gameLoop.addSystem('movement', movementSystem, { priority: 100 });
```

## Advanced Features

### Event System

The library provides database-backed event scheduling and processing:

```ts
// Create event system
const eventSystem = createEventSystem(world);

// Schedule events for systems
eventSystem.scheduleEvent(
  'movement', // target system
  'move:start',
  { direction: 'north' },
  Date.now() + 1000 // delayed execution
);

// Systems receive events automatically
const movementSystem: SystemFunction = (world, deltaTime, events) => {
  for (const { type, payload } of events) {
    if (type === 'move:start') {
      // Handle movement event
    }
  }
};
```

### Game Loop System

Game loops manage system execution with priority ordering and event delivery:

```ts
const gameLoop = createGameLoop(world);
gameLoop
  .addSystem('input', inputSystem, { priority: 100 })
  .addSystem('movement', movementSystem, { priority: 90 })
  .addSystem('collision', collisionSystem, { priority: 80 })
  .addSystem('render', renderSystem, { priority: 10 });

// Execute all systems with events
gameLoop.update(deltaTime);
```

### Component Lifecycle

```ts
// Add component to existing entity
const entityWithComponent = addComponent(entity, 'health', { hp: 100, max: 100 });

// Add multiple components
const entityWithComponents = addComponents(entity, {
  health: { hp: 100, max: 100 },
  position: { x: 0, y: 0 }
});

// Remove specific components
removeComponent(entity, 'health', 'position');

// Remove all components
removeComponent(entity);
```