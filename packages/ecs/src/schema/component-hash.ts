import { murmurHash } from 'odgn-helpers/hash';
import { toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo } from '@types';

import { cdefToSqlCreate } from './cdef-to-sql';

export type HashComponentDefinitionInput = Partial<CDef> & {
  columns: CDefColumnInfo[];
  id: string;
};

/**
 * Creates a deterministic hash for a component definition
 * This hash uses the generated SQL table structure and statements
 */
export const hashComponentDefinition = (
  def: HashComponentDefinitionInput
): string => {
  // Generate the SQL table structure
  const tableResult = cdefToSqlCreate(
    { ...def, hash: 'hash' },
    { tableName: `tbl_${toSnakeCase(def.id)}` }
  );

  // Create SHA-256 hash
  // return createHash('sha256').update(tableResult.sql).digest('hex');
  return murmurHash(tableResult.sql);
};

/**
 * Compares two component definition hashes and returns detailed differences
 */
export const compareComponentHashes = (
  existing: { hash: string; tbl_name: string },
  current: {
    definition: CDef;
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
export const summarizeComponentDefinition = (def: CDef): string => {
  const tableResult = cdefToSqlCreate(def);
  const fields = tableResult.columns
    .map(col => `${col.name}:${col.type}`)
    .join(', ');

  return `Table '${tableResult.tableName}' with columns: [${fields}]`;
};
