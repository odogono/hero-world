import { createHash } from 'node:crypto';

import type { SchemaType } from '@schema/types';
import type { ComponentDefinition } from '@types';

import { zodSchemaToSqliteTable } from './schema-to-sql';

/**
 * Creates a deterministic hash for a component definition
 * This hash uses the generated SQL table structure and statements
 */
export const hashComponentDefinition = (
  def: ComponentDefinition<string, SchemaType>
): string => {
  const { schema, statements } = def;

  // Generate the SQL table structure
  const tableResult = zodSchemaToSqliteTable(schema, { ifNotExists: false });

  // Create a canonical representation using SQL and statements
  const canonical = {
    columns: tableResult.columns.sort((a, b) => a.name.localeCompare(b.name)), // Sort for consistency
    sql: tableResult.sql,
    statements: statements || {},
    tableName: tableResult.tableName
  };

  // Sort keys to ensure consistent ordering
  const sortedCanonical = JSON.stringify(
    canonical,
    Object.keys(canonical).sort()
  );

  // Create SHA-256 hash
  return createHash('sha256').update(sortedCanonical).digest('hex');
};

/**
 * Compares two component definition hashes and returns detailed differences
 */
export const compareComponentHashes = (
  existing: { hash: string; tbl_name: string },
  current: {
    definition: ComponentDefinition<string, SchemaType>;
    hash: string;
    tbl_name: string;
  }
): {
  compatible: boolean;
  differences?: string[];
} => {
  if (existing.hash === current.hash) {
    return { compatible: true };
  }

  // Any hash difference is considered incompatible since we're using SQL structure
  return {
    compatible: false,
    differences: [
      `Component table '${current.tbl_name}' definition has changed`,
      `Expected hash: ${existing.hash}`,
      `Actual hash: ${current.hash}`,
      `The table structure or statements have been modified`
    ]
  };
};

/**
 * Creates a readable summary of a component definition for error messages
 */
export const summarizeComponentDefinition = (
  def: ComponentDefinition<string, SchemaType>
): string => {
  const { schema } = def;
  const tableResult = zodSchemaToSqliteTable(schema, { ifNotExists: false });
  const fields = tableResult.columns
    .map(col => `${col.name}:${col.type}`)
    .join(', ');

  return `Table '${tableResult.tableName}' with columns: [${fields}]`;
};
