/* eslint-disable perfectionist/sort-objects */
import type { Database } from '@db';
import type { CDef } from '@types';

import { defineComponent, s, type InferComponentType } from '../component/next';
import { cdefToSql } from './cdef-to-sql';
import { hashComponentDefinition } from './component-hash';

/**
 * Schema for storing component definition metadata in the database
 */
// export const componentMetadataSchema = z
//   .object({
//     created_at: z.string().default('CURRENT_TIMESTAMP'),
//     hash: z.string(),
//     id: pkWithAutoIncrement(),
//     tbl_name: z.string(),
//     version: z.number().default(1)
//   })
//   .meta({
//     description:
//       'Stores component definition hashes for compatibility checking',
//     name: 'tbl_component_metadata'
//   });

// export type ComponentMetadata = z.infer<typeof componentMetadataSchema>;

export const componentMetadata = defineComponent({
  id: 'component_metadata',
  schema: {
    id: s.pk(),
    tblName: s.string().indexed(),
    hash: s.string(),
    version: s.int().default(1),
    createdAt: s.datetime().default()
  }
});

// export const componentMetadata: CDef = {
//   columns: [
//     { name: 'id', type: 'pk' },
//     { isIndexed: true, name: 'tblName', type: 'string' },
//     { name: 'hash', type: 'string' },
//     { default: 1, name: 'version', optional: false, type: 'int' },
//     {
//       default: 'current_timestamp',
//       name: 'created_at',
//       optional: false,
//       type: 'datetime'
//     }
//   ],
//   id: 'component_metadata',
//   tableName: 'tbl_component_metadata'
// };

export type ComponentMetadata = InferComponentType<typeof componentMetadata>;

/**
 * Initializes the component metadata table in the database
 */
export const initializeComponentMetadataTable = (db: Database): void => {
  const { sql } = cdefToSql(componentMetadata, {});
  db.exec(sql);
};

/**
 * Stores component definition metadata in the database
 * @param db - Database instance
 * @param definitions - Component definitions to store
 * @param useTransaction - Whether to wrap in a transaction (default: true)
 */
export const storeComponentMetadata = (
  db: Database,
  definitions: CDef[],
  useTransaction: boolean = true
): void => {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tbl_component_metadata (tbl_name, hash, version)
    VALUES (:tbl_name, :hash, :version)
  `);

  const storeData = () => {
    for (const def of definitions) {
      const hash = hashComponentDefinition(def);
      insertStmt.run({
        hash,
        tbl_name: def.tableName!,
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

  const result: ComponentMetadata[] = [];
  const query = selectStmt.all();

  for (const row of query) {
    result.push({
      id: row.id,
      tblName: row.tbl_name,
      hash: row.hash,
      version: row.version,
      createdAt: row.created_at
    });
  }

  return result;
};

/**
 * Validates component definitions against stored metadata
 */
export const validateComponentCompatibility = (
  db: Database,
  currentDefinitions: CDef[]
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
      storedMetadata.map(meta => [meta.tblName, meta])
    );

    const currentByTableName = new Map(
      currentDefinitions.map(def => [
        def.tableName,
        {
          definition: def,
          hash: hashComponentDefinition(def),
          tableName: def.tableName
        }
      ])
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
      const stored = storedByTableName.get(tableName!);

      if (!stored) {
        // New component table - this is usually fine
        // warnings.push(
        //   `New component table '${tableName}' added to the world definition`
        // );
        continue;
      }

      const storedHash = stored?.hash;
      const currentHash = current.hash;

      // Check compatibility
      // const comparison = compareComponentHashes({ hash: storedHash, tbl_name: tableName! }, { hash: currentHash, tbl_name: tableName! });
      if (storedHash !== currentHash) {
        errors.push(
          `Component table definition mismatch for '${tableName}':`,
          `Stored hash: ${storedHash}`,
          `Current hash: ${currentHash}`
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
  definitions: CDef[]
): void => {
  // First, remove metadata for component tables that no longer exist
  const currentTableNames = definitions.map(def => def.tableName);
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
