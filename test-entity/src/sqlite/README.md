# Zod Schema to SQLite Table Converter

This module provides a function to convert Zod schemas into SQLite CREATE TABLE statements.

## Usage

```typescript
import * as z from "zod";
import { zodSchemaToSqliteTable } from './schema-to-sql';

// Define your Zod schema with table name in metadata
const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).max(150).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
}).meta({ name: 'users' });

// Convert to SQLite CREATE TABLE statement
const createTableSQL = zodSchemaToSqliteTable(userSchema);
console.log(createTableSQL);

// Or override the table name using options
const createTableSQL2 = zodSchemaToSqliteTable(userSchema, { tableName: 'custom_users' });
```

## Supported Zod Types

The converter supports the following Zod types and maps them to SQLite types:

| Zod Type | SQLite Type | Notes |
|----------|-------------|-------|
| `z.number()` | `REAL` | Default for numbers |
| `z.number().int()` | `INTEGER` | When integer constraint is detected |
| `z.string()` | `TEXT` | All string types |
| `z.boolean()` | `INTEGER` | Stored as 0/1 |
| `z.date()` | `TEXT` | Stored as ISO string |
| `z.iso.datetime()` | `DATETIME` | SQLite DATETIME type |
| `z.enum()` | `TEXT` | Enum values as strings |
| `z.literal()` | `TEXT/INTEGER/REAL` | Based on literal value type |
| `z.union()` | `TEXT` | Union types as text |
| `z.optional()` | `NULL` | Optional fields are nullable |
| `z.nullable()` | `NULL` | Nullable fields are nullable |
| `z.default()` | `NOT NULL` | Default values handled by app layer |

## Special Field Handling

### Primary Key
- Fields named `id` are automatically treated as `INTEGER PRIMARY KEY AUTOINCREMENT`

### Timestamps
- Fields named `createdAt` or `updatedAt` are treated as `TEXT` for ISO datetime strings

### Constraints
- Non-optional fields get `NOT NULL` constraint
- Optional/nullable fields get `NULL` constraint
- Primary key fields get `PRIMARY KEY AUTOINCREMENT` constraints

### Column Name Conversion
- All column names are automatically converted to snake_case
- Examples: `firstName` → `first_name`, `createdAt` → `created_at`, `userId` → `user_id`

### Default Values
- Default values can be specified using Zod metadata: `z.string().meta({ default: "'value'" })`
- Examples: `z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP' })`
- Default constraints are added to the SQL: `column_name TYPE NOT NULL DEFAULT value`

## Example Output

```sql
CREATE TABLE users (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  age REAL NULL,
  is_active INTEGER NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Limitations

- Complex nested objects are stored as `TEXT` (JSON strings)
- Arrays are stored as `TEXT` (JSON strings)
- Default values are not included in the SQL (handled by application layer)
- Foreign key relationships are not automatically detected
- Indexes are not generated

## Function Signature

```typescript
function zodSchemaToSqliteTable(
  schema: z.ZodObject<any>, 
  options?: { tableName?: string }
): string
```

### Parameters

- `schema`: The Zod object schema to convert
- `options.tableName`: Optional override for the table name from schema metadata

### Table Name Resolution

The table name is determined in the following order:
1. `options.tableName` (if provided)
2. `schema.meta()?.name` (from schema metadata)
3. Throws an error if neither is available

### Error Handling

If no table name is provided, the function throws an error:

```typescript
const schema = z.object({ id: z.number() });
zodSchemaToSqliteTable(schema); // Throws: "Table name must be specified either in schema metadata (schema.meta({ name: "table_name" })) or in options parameter"
```

## TypeScript Support

The function includes TypeScript types and a helper type for extracting inferred types:

```typescript
import { InferTableSchema } from './schema-to-sql';

type User = InferTableSchema<typeof userSchema>;
```
