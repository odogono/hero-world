import { z } from 'zod';

import type { Database } from '@db';
import type { SchemaType } from '@schema/types';
import type { ComponentDefinition } from '@types';

import { pkWithAutoIncrement } from '../schema';
import {
  compareComponentHashes,
  hashComponentDefinition
} from './component-hash';
import { zodSchemaToSqliteTable } from './schema-to-sql';

/**
 * Schema for storing component definition metadata in the database
 */
export const componentMetadataSchema = z
  .object({
    created_at: z.string().default('CURRENT_TIMESTAMP'),
    hash: z.string(),
    id: pkWithAutoIncrement(),
    tbl_name: z.string(),
    version: z.number().default(1)
  })
  .meta({
    description:
      'Stores component definition hashes for compatibility checking',
    name: 'tbl_component_metadata'
  });

export type ComponentMetadata = z.infer<typeof componentMetadataSchema>;

/**
 * Initializes the component metadata table in the database
 */
export const initializeComponentMetadataTable = (db: Database): void => {
  const { sql } = zodSchemaToSqliteTable(componentMetadataSchema, {
    ifNotExists: true
  });
  db.exec(sql);

  // Create unique index on table name
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_component_metadata_tbl_name 
    ON tbl_component_metadata (tbl_name)
  `);
};

/**
 * Stores component definition metadata in the database
 * @param db - Database instance
 * @param definitions - Component definitions to store
 * @param useTransaction - Whether to wrap in a transaction (default: true)
 */
export const storeComponentMetadata = (
  db: Database,
  definitions: ComponentDefinition<string, SchemaType>[],
  useTransaction: boolean = true
): void => {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tbl_component_metadata (tbl_name, hash, created_at, version)
    VALUES (:tbl_name, :hash, :created_at, :version)
  `);

  const storeData = () => {
    for (const def of definitions) {
      const hash = hashComponentDefinition(def);
      const tableResult = zodSchemaToSqliteTable(def.schema, {
        ifNotExists: false
      });
      insertStmt.run({
        created_at: new Date().toISOString(),
        hash,
        tbl_name: tableResult.tableName,
        version: 1
      });
    }
  };

  if (useTransaction) {
    db.transaction(storeData);
  } else {
    storeData();
  }
};

/**
 * Retrieves all component metadata from the database
 */
export const getStoredComponentMetadata = (
  db: Database
): ComponentMetadata[] => {
  const selectStmt = db.prepare(`
    SELECT id, tbl_name, hash, created_at, version 
    FROM tbl_component_metadata 
    ORDER BY tbl_name
  `);

  return selectStmt.all() as ComponentMetadata[];
};

/**
 * Validates component definitions against stored metadata
 */
export const validateComponentCompatibility = (
  db: Database,
  currentDefinitions: ComponentDefinition<string, SchemaType>[]
): {
  compatible: boolean;
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const storedMetadata = getStoredComponentMetadata(db);
    const storedByTableName = new Map(
      storedMetadata.map(meta => [meta.tbl_name, meta])
    );

    const currentByTableName = new Map(
      currentDefinitions.map(def => {
        const tableResult = zodSchemaToSqliteTable(def.schema, {
          ifNotExists: false
        });
        return [
          tableResult.tableName,
          {
            definition: def,
            hash: hashComponentDefinition(def),
            tbl_name: tableResult.tableName
          }
        ];
      })
    );

    // Check for removed components (tables)
    for (const [tableName] of storedByTableName) {
      if (!currentByTableName.has(tableName)) {
        warnings.push(
          `Component table '${tableName}' was removed from the world definition`
        );
      }
    }

    // Check for new or modified components
    for (const [tableName, current] of currentByTableName) {
      const stored = storedByTableName.get(tableName);

      if (!stored) {
        // New component table - this is usually fine
        warnings.push(
          `New component table '${tableName}' added to the world definition`
        );
        continue;
      }

      // Check compatibility
      const comparison = compareComponentHashes(stored, current);
      if (!comparison.compatible) {
        errors.push(
          `Component table definition mismatch for '${tableName}':`,
          ...(comparison.differences || [])
        );
      }
    }

    return {
      compatible: errors.length === 0,
      errors,
      warnings
    };
  } catch (error) {
    return {
      compatible: false,
      errors: [`Failed to validate component compatibility: ${error}`],
      warnings: []
    };
  }
};

/**
 * Updates component metadata after successful validation
 * This should be called after the world has been successfully created
 */
export const updateComponentMetadata = (
  db: Database,
  definitions: ComponentDefinition<string, SchemaType>[]
): void => {
  // First, remove metadata for component tables that no longer exist
  const currentTableNames = definitions.map(def => {
    const tableResult = zodSchemaToSqliteTable(def.schema, {
      ifNotExists: false
    });
    return tableResult.tableName;
  });
  const placeholders = currentTableNames.map((_, i) => `?${i + 1}`).join(',');

  if (currentTableNames.length > 0) {
    db.exec(
      `DELETE FROM tbl_component_metadata WHERE tbl_name NOT IN (${placeholders})`,
      currentTableNames
    );
  } else {
    db.exec('DELETE FROM tbl_component_metadata');
  }

  // Then store/update current component metadata (no transaction since we may be in one)
  storeComponentMetadata(db, definitions, false);
};
