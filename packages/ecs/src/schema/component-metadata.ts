/* eslint-disable perfectionist/sort-objects */

import {
  defineComponent,
  s,
  toTableName,
  type InferComponentType
} from '../component';
import type { Database } from '../db';
import type { CDef } from '../types';
import { cdefToSql } from './cdef-to-sql';
import { hashComponentDefinition } from './component-hash';

export const componentMetadata = defineComponent({
  id: 'component_metadata',
  schema: {
    defId: s.string(),
    hash: s.string().unique(),
    version: s.int().default(1)
  }
});

export type ComponentMetadata = InferComponentType<typeof componentMetadata>;

/**
 * Initializes the component metadata table in the database
 */
export const initializeComponentMetadataTable = (db: Database): void => {
  const { sql } = cdefToSql(componentMetadata, {
    tableName: 'tbl_component_metadata'
  });
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
    INSERT OR REPLACE INTO tbl_component_metadata (def_id, hash, version)
    VALUES (:def_id, :hash, :version)
  `);

  const storeData = () => {
    for (const def of definitions) {
      const hash = hashComponentDefinition(def);
      insertStmt.run({
        hash,
        def_id: def.id!,
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
    SELECT id, def_id, hash, created_at, version 
    FROM tbl_component_metadata 
    ORDER BY def_id, created_at
    
  `);

  const result: ComponentMetadata[] = [];
  const query = selectStmt.all();

  for (const row of query) {
    result.push({
      id: row.id,
      defId: row.def_id,
      hash: row.hash,
      version: row.version,
      createdAt: row.created_at
    });
  }

  return result;
};

type ValidateOptions = {
  allowRedefineDefinitions: boolean;
};

/**
 * Validates component definitions against stored metadata
 */
export const validateComponentCompatibility = (
  db: Database,
  currentDefinitions: CDef[],
  options: ValidateOptions = { allowRedefineDefinitions: true }
): {
  compatible: boolean;
  errors: string[];
  warnings: string[];
} => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const allowRedefineDefinitions = options.allowRedefineDefinitions ?? true;

  try {
    const storedMetadata = getStoredComponentMetadata(db);
    const storedByHash = new Map(storedMetadata.map(meta => [meta.hash, meta]));
    const storedByDefId = new Map(
      storedMetadata.map(meta => [meta.defId, meta])
    );

    const currentByHash = new Map(
      currentDefinitions.map(def => [
        def.hash,
        {
          definition: def,
          hash: hashComponentDefinition(def),
          defId: def.id!
        }
      ])
    );

    // console.log('storedByHash', storedByHash);

    // Check for removed components (tables)
    for (const [hash, { defId }] of storedByHash) {
      if (!currentByHash.has(hash)) {
        warnings.push(
          `Component table '${toTableName(defId, hash)}' was removed from the world definition`
        );
      }
    }

    // Check for new or modified components
    for (const [hash, { defId }] of currentByHash) {
      if (allowRedefineDefinitions === false) {
        if (storedByDefId.has(defId)) {
          errors.push(
            `Component table '${toTableName(defId, hash)}' was redefined in the world definition`
          );
          continue;
        }
      }

      const stored = storedByHash.get(hash);

      if (!stored) {
        // New component table - this is usually fine
        warnings.push(
          `New component table '${toTableName(defId, hash)}' added to the world definition`
        );
        continue;
      }

      const storedHash = stored?.hash;
      const currentHash = hash;

      // Check compatibility
      // const comparison = compareComponentHashes({ hash: storedHash, tbl_name: tableName! }, { hash: currentHash, tbl_name: tableName! });
      if (storedHash !== currentHash) {
        errors.push(
          `Component table definition mismatch for '${toTableName(defId, hash)}':`,
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
  const currentTableNames = definitions.map(def => def.hash);

  if (currentTableNames.length > 0) {
    const placeholders = currentTableNames.map(() => '?').join(',');
    const deleteStmt = db.prepare(
      `DELETE FROM tbl_component_metadata WHERE hash NOT IN (${placeholders})`
    );
    deleteStmt.run(...currentTableNames);
  } else {
    db.exec('DELETE FROM tbl_component_metadata');
  }

  // Then store/update current component metadata (no transaction since we may be in one)
  storeComponentMetadata(db, definitions, false);
};
