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
const world = createWorld()
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

### Path Aliases (tsconfig.json)

- `@/*` → `./src/*`
- `@component` → `./src/component`
- `@entity` → `./src/entity`
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

### Game Engine Files

- `src/events/event-system.ts` - Type-safe event publishing/subscribing with queuing
- `src/events/persistent.ts` - Database-backed event persistence with scheduling and replay capabilities
- `src/events/event-game-loop.ts` - Event-aware game loop integration
- `src/system/game-loop.ts` - Game loop with priority-based system execution and performance tracking

### Utility Files

- `src/helpers/string.ts` - String utilities (camelCase, snake_case conversion)
- `src/helpers/trycatch.ts` - Error handling utilities
- `src/helpers/log.ts` - Logging utilities
- `src/schema/schema-to-sql.ts` - Zod schema to SQLite conversion
- `src/schema/types.ts` - Schema and table generation type definitions

## Development Guidelines

### Bun Runtime

- Use `bun:sqlite` for database operations (already configured)
- Use `bun test` for testing with built-in expect/test functions
- Prefer `Bun.file` over Node.js fs operations

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
- Helper tests in `src/helpers/__test__/`: `schema-to-sql.test.ts`, `string.test.ts`, `trycatch.test.ts`

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

## Advanced Features

### Event System

The library provides both in-memory and persistent event systems:

```ts
// In-memory event system
const eventSystem = createEventSystem<GameEvents>();
eventSystem.subscribe('entity:damaged', event => {
  console.log(`Entity ${event.entityId} took ${event.damage} damage`);
});
eventSystem.publish('entity:damaged', { entityId: 1, damage: 50 });

// Persistent event system with database storage
const persistentEvents = createPersistentEventSystem(world);
persistentEvents.scheduleEvent(
  'spawn:enemy',
  { type: 'orc' },
  Date.now() + 5000
);
```

### Game Loop System

Game loops manage system execution with priority ordering and performance tracking:

```ts
const gameLoop = createGameLoop(world);
gameLoop
  .addSystem('movement', movementSystem, { priority: 100 })
  .addSystem('collision', collisionSystem, { priority: 50 })
  .addSystem('render', renderSystem, { priority: 10 });

// Execute systems each frame
gameLoop.update(deltaTime);
```

### Persistent Events

Events can be persisted to the database for scheduling, retry logic, and replay:

```ts
// Schedule an event for later
persistentEvents.scheduleEvent(
  'delayed:action',
  { data: 'test' },
  futureTimestamp
);

// Process scheduled events
persistentEvents.processScheduledEvents();

// Replay events from a time range
persistentEvents.replayTimeRange(startTime, endTime);
```
