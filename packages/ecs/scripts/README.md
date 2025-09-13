# ECS Code Generation Scripts

This directory contains scripts for generating TypeScript types and SQLite schemas from ECS component definitions.

## Schema Generation Script

### Usage

#### Using npm scripts:
```bash
# Run with default component file (__test__/definitions.ts)
bun run generate

# Run with a specific component file
bun run scripts/generate-schemas.ts path/to/components.ts

# Show help
bun run generate:help
```

#### Using Justfile (recommended):
```bash
# Run with default component file
just generate-schemas

# Run with a specific component file
just generate-schemas src/components.ts
just generate-schemas ../tank-world/src/components.ts

# Show help
just generate-schemas-help

# Clean generated files
just clean
```

The script automatically discovers all exported component definitions from any TypeScript file, making it flexible and reusable across different component files.

### What it generates

The script reads component definitions from any specified TypeScript file and generates:

1. **TypeScript component types** (`generated/component-types.ts`)
   - Individual component type definitions
   - Zod schemas for runtime validation
   - Union type for all components
   - Components interface for ECS World type inference

2. **SQLite schema** (`generated/schema.sql`)
   - CREATE TABLE statements for each component
   - Proper foreign key relationships with cascade delete
   - Indexes where specified in component metadata
   - Compatible with the ECS library's SQLite backend

### Generated Files

```
generated/
├── component-types.ts  # TypeScript types and Zod schemas
└── schema.sql         # SQLite database schema
```

### Example Output

**TypeScript Types:**
```typescript
export type PositionComponent = z.infer<typeof positionComponentSchema>;
export const positionComponentSchema = z.object({
  x: z.number(),
  y: z.number()
});

export interface Components {
  position: PositionComponent;
  velocity: VelocityComponent;
  // ...
}
```

**SQLite Schema:**
```sql
CREATE TABLE IF NOT EXISTS tbl_position (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eid INTEGER NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE
);
```

### Adding New Components

1. Define your component in any TypeScript file using `defineComponent()`
2. Export it from the file
3. Run `bun run generate` (for default file) or `bun run scripts/generate-schemas.ts path/to/your/components.ts`

The script automatically discovers all exported components - no manual configuration needed!

### Features

- **Type Safety**: Generated TypeScript types provide full type safety
- **Schema Validation**: Zod schemas enable runtime validation
- **Database Integration**: SQLite schema works seamlessly with the ECS library
- **Automatic Field Mapping**: Handles camelCase ↔ snake_case conversion
- **Foreign Keys**: Proper entity relationships with cascade delete
- **Default Values**: Preserves default values from component definitions