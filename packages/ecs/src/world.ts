import { createLog } from 'odgn-helpers/log';

import {
  DatabaseType,
  createDatabase,
  type CreateDatabaseOptions,
  type Database,
  type LoadFromJSONOptions,
  type SaveToJSONOptions,
  type Statement
} from '@db';
import { convertKeysToSnakeCase } from '@helpers/convert-keys';
import {
  initializeComponentMetadataTable,
  updateComponentMetadata,
  validateComponentCompatibility
} from '@schema/component-metadata';
import {
  type CDef,
  type ComponentDef,
  type ComponentDefinition,
  type Components,
  type EntityCache,
  type InferComponentsFromDefs,
  type StaticWorld
} from '@types';

import {
  cdefToSqlCreate,
  cdefToSqlInsert,
  cdefToSqlUpdate
} from './schema/cdef-to-sql';

const log = createLog('world');

type CreateStaticWorldOptionsInternal = Partial<CreateDatabaseOptions> & {
  dbType?: DatabaseType;
};

const createStaticWorldInternal = async <T extends Components>(
  componentDefs: CDef[],
  options: CreateStaticWorldOptionsInternal = {}
): Promise<StaticWorld<T>> => {
  const dirtyEntities = new Map<number, Set<keyof Components>>();
  const entitiesToDelete = new Set<number>();
  const entityCache: EntityCache<T> = new Map();
  const defs = new Map<string, ComponentDef>();

  const db = await createDatabase({
    ...options,
    type: options.dbType || DatabaseType.BUN
  });

  db.exec('PRAGMA foreign_keys = ON');

  // Create entity table
  const sql =
    'CREATE TABLE IF NOT EXISTS tbl_entity (id INTEGER PRIMARY KEY AUTOINCREMENT)';
  db.exec(sql);

  // Initialize component metadata table for compatibility checking
  initializeComponentMetadataTable(db);

  // Validate component compatibility

  const validation = validateComponentCompatibility(db, componentDefs);

  if (!validation.compatible) {
    const errorMessage = [
      'Component definition compatibility check failed:',
      ...validation.errors,
      '',
      'This usually means the component definitions in your code have changed',
      'in a way that is incompatible with the existing database.',
      '',
      'To resolve this:',
      '1. Update your component definitions to match the existing schema, or',
      '2. Create a new database file'
    ].join('\n');

    throw new Error(errorMessage);
  }

  // Log warnings if any
  if (validation.warnings.length > 0) {
    log.warn('Component definition warnings:');
    validation.warnings.forEach(warning => log.warn(`  ${warning}`));
  }

  // Register all components in a single transaction
  db.transaction(() => {
    for (const def of componentDefs) {
      registerComponentDefStatic(db, defs, def, def.statements);
    }

    // Update component metadata after successful registration

    updateComponentMetadata(db, componentDefs);
  });

  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?;');
  const selectEntityById = db.prepare(
    'SELECT id FROM tbl_entity WHERE id = ?;'
  );

  const componentTypes = componentDefs.map(def => def.id) as (keyof T)[];

  return {
    close: () => db.close(),
    componentTypes: componentTypes as keyof T,
    db,
    defs,
    dirtyEntities,
    entitiesToDelete,
    entityCache,
    flush: () =>
      flush({
        db,
        defs,
        dirtyEntities,
        entitiesToDelete,
        entityCache
      } as StaticWorld<T>),
    stmts: {
      deleteEntity,
      selectEntityById
    }
  };
};

// Create world with component definitions
export const createWorld = async (
  componentDefs: CDef[],
  options?: CreateStaticWorldOptionsInternal
) => createStaticWorldInternal(componentDefs, options || {});

const registerComponentDefStatic = (
  db: Database,
  defs: Map<string, ComponentDef>,
  componentDef: CDef,
  statements: Record<string, string> = {}
): void => {
  const name = componentDef.id;

  const result = cdefToSqlCreate(componentDef);
  db.exec(result.sql);

  const sqlInsert = cdefToSqlInsert(componentDef, {
    namedParams: true
  });
  const sqlUpdate = cdefToSqlUpdate(componentDef, {
    namedParams: true
  });

  const additionalStmts = Object.entries(statements).reduce(
    (acc, [key, sql]) => {
      acc[key] = db.prepare(sql);
      return acc;
    },
    {} as Record<string, Statement>
  );

  const def = {
    columns: result.columns,
    name,
    schema: componentDef,
    stmtInsert: db.prepare(sqlInsert),
    stmtUpdate: db.prepare(sqlUpdate),
    tableName: result.tableName,
    url: componentDef.id!,
    ...additionalStmts
  } as ComponentDef;

  defs.set(name, def);
};

const flush = <T extends Components>(world: StaticWorld<T>) => {
  const { db, defs, dirtyEntities, entitiesToDelete, entityCache } = world;

  db.transaction(() => {
    // Handle entity deletions first
    if (entitiesToDelete.size > 0) {
      const entityIds = Array.from(entitiesToDelete);
      const placeholders = entityIds
        .map((_, index) => `?${index + 1}`)
        .join(',');
      const deleteSql = `DELETE FROM tbl_entity WHERE id IN (${placeholders})`;

      db.exec(deleteSql, entityIds);

      for (const eid of entityIds) {
        entityCache.delete(eid);
        dirtyEntities.delete(eid);
      }
    }

    // Handle component updates and insertions
    for (const [eid, components] of dirtyEntities.entries()) {
      if (!entityCache.has(eid)) {
        continue;
      }

      const cache = entityCache.get(eid);

      for (const c of components) {
        const entry = cache![c as string]!;
        const def = defs.get(c as string);
        if (!def) {
          throw new Error(`Component def not found for ${c as string}`);
        }

        if (entry.exists === false && entry.data === null) {
          continue;
        }

        const serializeValues = (obj: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            if (v === null || v === undefined) {
              out[k] = v as any;
              continue;
            }
            if (v instanceof Date) {
              out[k] = v.toISOString();
              continue;
            }
            if (typeof v === 'object') {
              out[k] = JSON.stringify(v);
              continue;
            }
            out[k] = v as any;
          }
          return out;
        };

        if (entry.exists) {
          // update
          const { id, ...dataWithoutId } = entry.data as Record<
            string,
            unknown
          >;
          const updateData = serializeValues(
            convertKeysToSnakeCase({ ...dataWithoutId, eid })
          );
          def!.stmtUpdate.run(updateData);
        } else {
          // insert
          const { id, ...dataWithoutId } = entry.data as Record<
            string,
            unknown
          >;
          const insertData = serializeValues(
            convertKeysToSnakeCase({ ...dataWithoutId, eid })
          );
          def!.stmtInsert.run(insertData);
          entry.exists = true;
        }
      }
    }

    // Handle deferred component deletions
    for (const [eid, components] of dirtyEntities.entries()) {
      if (!entityCache.has(eid)) {
        continue;
      }

      const cache = entityCache.get(eid);
      if (!cache) {
        continue;
      }

      for (const c of components) {
        const entry = cache[c as string];
        if (entry && entry.exists === false && entry.data === null) {
          const def = defs.get(c as string);
          if (def) {
            db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, eid);
            delete cache[c as string];
          }
        }
      }
    }
  });

  // Clear all tracking
  dirtyEntities.clear();
  entitiesToDelete.clear();

  return world;
};

// Export flush as the main flush function

export { flush };

// World utility functions
export const loadWorldFromJSON = <T extends Components>(
  world: StaticWorld<T>,
  json: unknown,
  options: LoadFromJSONOptions = {}
) => world.db.loadFromJSON(json, options);

export const saveWorldToJSON = <T extends Components>(
  world: StaticWorld<T>,
  options: SaveToJSONOptions = {}
) => world.db.saveToJSON(options);

export const saveWorld = async <T extends Components>(
  world: StaticWorld<T>,
  path: string
) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  await world.db.saveToPath(path);
};

/**
 * Loads an existing world database from a file path with component compatibility validation
 */
export const loadWorld = async <T extends readonly ComponentDefinition[]>(
  componentDefs: CDef[],
  path: string,
  options?: Omit<CreateStaticWorldOptionsInternal, 'path'>
): Promise<StaticWorld<InferComponentsFromDefs<T>>> => {
  // Check if the database file exists
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Database file not found: ${path}`);
  }

  // Create world with the existing database file
  return createWorld(componentDefs, {
    ...options,
    path
  });
};
