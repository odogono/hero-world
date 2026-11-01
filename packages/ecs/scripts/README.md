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
just generate-schemas path/to/components.ts

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

## CDef JSON Generation Script

Generate SQL and Zod schema text directly from JSON component definitions in the CDef format used by the ECS package.

### Usage

```bash
# From a JSON file containing a CDef, CDef[] or nested arrays
bun run scripts/generate-from-cdef.ts --input path/to/cdefs.json \
  --sql-out generated/schema.sql \
  --zod-out generated/schemas.ts \
  --include-entity \
  --down

# Omit imports in Zod output (useful for embedding into existing files)
bun run scripts/generate-from-cdef.ts --input cdefs.json --zod-no-imports
```

Options:

- `--input <path>` JSON file with a single CDef, `CDef[]`, or nested array
- `--sql-out <path>` Write SQL output to file
- `--zod-out <path>` Write Zod schemas TS to file
- `--include-entity` Include `tbl_entity` in SQL output
- `--down` Append DROP statements after CREATE
- `--zod-no-imports` Omit `import { z } from 'zod'` in Zod output

This script uses the same conversion logic as the library functions `cdefToSql` and `cdefToZod`.

## EDL Generation Script

Generate SQL (including INSERTs for entities), TypeScript types, and Zod schemas directly from an EDL file.

### Usage

```bash
# From an EDL file
bun run scripts/generate-from-edl.ts --input examples/zork.edl \
  --sql-out generated/zork.sql \
  --types-out generated/components.d.ts \
  --zod-out generated/schemas.ts \
  --include-entity

# Print to stdout (no outputs specified)
bun run scripts/generate-from-edl.ts --input examples/zork.edl --include-entity
```

Options:

- `--input <path>` EDL file path
- `--sql-out <path>` Write SQL (DDL + entity/component INSERTs) to file
- `--types-out <path>` Write TypeScript component types to file
- `--zod-out <path>` Write Zod schemas TS to file
- `--include-entity` Include `tbl_entity` in SQL up/down
- `--down` Append DROP statements after CREATE
- `--zod-no-imports` Omit `import { z } from 'zod'` in Zod output

Notes:

- Entity IDs are assigned deterministically in order of appearance starting at 1, and `$name` references are resolved to these IDs.
- Inherited components via `extends` are merged (atoms and entities supported); entity-local component values override inherited values.
- Component columns are matched via camelCase ↔ snake_case mapping.
