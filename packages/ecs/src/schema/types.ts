import { z } from 'zod';

export type SchemaType = z.ZodTypeAny;

/**
 * Column information for SQLite table generation
 */
export type ColumnInfo = {
  constraints: string[];
  name: string;
  type: string;
};

/**
 * Index information for SQLite index generation
 */
export type IndexInfo = {
  columns: string[];
  name: string;
  tableName: string;
  unique: boolean;
};

/**
 * Result of converting a Zod schema to SQLite table
 */
export type TableGenerationResult = {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  sql: string;
  tableName: string;
};

/**
 * Result of converting a Zod schema to SQLite indexes
 */
export type IndexGenerationResult = {
  indexes: IndexInfo[];
  sql: string[];
};

export type ZodSchemaToSqliteTableOptions = {
  ifNotExists?: boolean;
  tableName?: string;
};

export type StatementOptions = {
  namedParams?: boolean;
  tableName?: string;
};
