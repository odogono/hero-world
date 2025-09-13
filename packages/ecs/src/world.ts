import { createLog } from 'odgn-helpers/log';
import z from 'zod';

import {
  DatabaseType,
  createDatabase,
  type CreateDatabaseOptions,
  type LoadFromJSONOptions,
  type SaveToJSONOptions
} from '@db';
import { convertKeysToSnakeCase } from '@helpers/convert-keys';
import {
  zodSchemaToSqliteInsert,
  zodSchemaToSqliteTable,
  zodSchemaToSqliteUpdate
} from '@schema/schema-to-sql';
import type { SchemaType } from '@schema/types';
import {
  entitySchema,
  type ComponentDef,
  type ComponentDefinition,
  type Components,
  type EntityCache,
  type InferComponentsFromDefs,
  type StaticWorld
} from '@types';

const log = createLog('world');

type CreateStaticWorldOptionsInternal = Partial<CreateDatabaseOptions> & {
  dbType?: DatabaseType;
};

const createStaticWorldInternal = async <T extends Components>(
  componentDefs: ComponentDefinition<string, SchemaType>[],
  options: CreateStaticWorldOptionsInternal = {}
): Promise<StaticWorld<T>> => {
  const registry = z.registry();
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
  const { sql } = zodSchemaToSqliteTable(entitySchema, {
    ifNotExists: true
  });
  db.exec(sql);

  // Register all components in a single transaction
  db.transaction(() => {
    for (const def of componentDefs) {
      registerComponentDefStatic(
        registry,
        db,
        defs,
        def.schema,
        def.statements || {}
      );
    }
  });

  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?;');
  const selectEntityById = db.prepare(
    'SELECT id FROM tbl_entity WHERE id = ?;'
  );

  const componentTypes = componentDefs.map(def => def.name) as (keyof T)[];

  return {
    close: () => db.close(),
    componentTypes: componentTypes as keyof T,
    db,
    defs,
    dirtyEntities,
    entitiesToDelete,
    entityCache,
    flush: () =>
      flushStatic({
        db,
        defs,
        dirtyEntities,
        entitiesToDelete,
        entityCache
      } as StaticWorld<T>),
    registry,
    stmts: {
      deleteEntity,
      selectEntityById
    }
  };
};


// Create world with component definitions
export async function createWorld<
  T extends readonly ComponentDefinition<string, SchemaType>[]
>(
  componentDefs: T,
  options?: CreateStaticWorldOptionsInternal
): Promise<StaticWorld<InferComponentsFromDefs<T>>> {
  return createStaticWorldInternal<InferComponentsFromDefs<T>>(
    componentDefs as ComponentDefinition<string, SchemaType>[],
    options || {}
  );
}

// Legacy alias for backward compatibility
export const createStaticWorld = createWorld;

// Alternative overload for when you want to provide explicit types
export const createStaticWorldTyped = async <T extends Components>(
  componentDefs: ComponentDefinition<string, SchemaType>[],
  options: CreateStaticWorldOptionsInternal = {}
): Promise<StaticWorld<T>> =>
  createStaticWorldInternal<T>(componentDefs, options);

const registerComponentDefStatic = (
  registry: ReturnType<typeof z.registry>,
  db: any,
  defs: Map<string, ComponentDef>,
  componentDef: SchemaType,
  statements: Record<string, string> = {}
): void => {
  const meta = componentDef.meta();

  if (!meta?.id) {
    throw new Error('componentDef must have an id');
  }

  if (registry.get(componentDef)) {
    return;
  }

  registry.add(componentDef, {
    description: meta.description ?? meta.id
  });

  const name = meta.id;

  const result = zodSchemaToSqliteTable(componentDef, { ifNotExists: true });
  db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef, {
    namedParams: true
  });
  const sqlUpdate = zodSchemaToSqliteUpdate(componentDef, {
    namedParams: true
  });

  const additionalStmts = Object.entries(statements).reduce(
    (acc, [key, sql]) => {
      acc[key] = db.prepare(sql);
      return acc;
    },
    {} as Record<string, any>
  );

  const def = {
    columns: result.columns,
    name,
    schema: componentDef,
    stmtInsert: db.prepare(sqlInsert),
    stmtUpdate: db.prepare(sqlUpdate),
    tableName: result.tableName,
    url: meta.id!,
    ...additionalStmts
  } as ComponentDef;

  defs.set(name, def);
};

const flushStatic = <T extends Components>(world: StaticWorld<T>) => {
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

        if (entry.exists) {
          // update
          const { id, ...dataWithoutId } = entry.data as Record<
            string,
            unknown
          >;
          const updateData = convertKeysToSnakeCase({ ...dataWithoutId, eid });
          def!.stmtUpdate.run(updateData);
        } else {
          // insert
          const { id, ...dataWithoutId } = entry.data as Record<
            string,
            unknown
          >;
          const insertData = convertKeysToSnakeCase({ ...dataWithoutId, eid });
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
export const flush = flushStatic;
export { flushStatic };

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
