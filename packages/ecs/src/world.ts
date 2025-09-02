import { createLog } from 'odgn-helpers/log';
import z from 'zod';

import {
  DatabaseType,
  createDatabase,
  type CreateDatabaseOptions,
  type LoadFromJSONOptions,
  type SaveToJSONOptions,
  type Statement
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
  type World,
  type WorldBuilderGeneric
} from '@types';

const log = createLog('world');

type CreateWorldOptions = Partial<CreateDatabaseOptions> & {
  dbType?: DatabaseType;
};

const createWorldInternal = async <T extends Components>(
  options: CreateWorldOptions = {}
): Promise<World<T>> => {
  const registry = z.registry();
  const dirtyEntities = new Map<number, Set<keyof Components>>();
  const entitiesToDelete = new Set<number>();
  const entityCache: EntityCache<T> = new Map();

  const db = await createDatabase({
    ...options,
    type: options.dbType || DatabaseType.BUN
  });

  db.exec('PRAGMA foreign_keys = ON');

  const { sql } = zodSchemaToSqliteTable(entitySchema, {
    ifNotExists: true
  });

  db.exec(sql);

  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?;');
  const selectEntityById = db.prepare(
    'SELECT id FROM tbl_entity WHERE id = ?;'
  );

  return {
    close: () => db.close(),
    db,
    defs: new Map(),
    dirtyEntities,
    entitiesToDelete,
    entityCache,
    flush: () => ({}) as unknown as World<T>,
    registry,
    stmts: {
      deleteEntity,
      selectEntityById
    }
  };
};

export const createWorld = async <T extends Components>(
  options: CreateWorldOptions = {}
): Promise<WorldBuilderGeneric<T>> => {
  const world = await createWorldInternal<T>(options);

  const build = <U extends Components = T>(): World<U> =>
    ({ ...world, flush: () => flush(world) }) as World<U>;

  const registerComponent = <Name extends string, Schema extends SchemaType>(
    def: ComponentDefinition<Name, Schema>
  ): WorldBuilderGeneric<T & { [K in Name]: z.infer<Schema> }> => {
    registerComponentDef(world, def.schema, def.statements || {});

    return {
      ...world,
      build: build<T & { [K in Name]: z.infer<Schema> }>,
      registerComponent
    } as WorldBuilderGeneric<T & { [K in Name]: z.infer<Schema> }>;
  };

  return {
    ...world,
    build: build<T>,
    registerComponent
  };
};

export const loadWorldFromJSON = <T extends Components>(
  world: World<T>,
  json: unknown,
  options: LoadFromJSONOptions = {}
) => world.db.loadFromJSON(json, options);

export const saveWorldToJSON = <T extends Components>(
  world: World<T>,
  options: SaveToJSONOptions = {}
) => world.db.saveToJSON(options);

export const saveWorld = async <T extends Components>(
  world: World<T>,
  path: string
) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  await world.db.saveToPath(path);
};

type ComponentStatements = {
  [key: string]: string;
};

const registerComponentDef = <T extends Components>(
  world: World<T>,
  componentDef: SchemaType,
  statements: ComponentStatements = {}
): World<T> => {
  const meta = componentDef.meta();

  if (!meta?.id) {
    throw new Error('componentDef must have an id');
  }

  if (world.registry.get(componentDef)) {
    return world;
  }

  world.registry.add(componentDef, {
    description: meta.description ?? meta.id
  });

  const name = meta.id;

  // const existing = world.defs.get(name);
  // if (existing) {
  //   return world;
  // }

  const result = zodSchemaToSqliteTable(componentDef, { ifNotExists: true });
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef, {
    namedParams: true
  });
  // log.debug('[registerComponentDef] sqlInsert', sqlInsert);
  const sqlUpdate = zodSchemaToSqliteUpdate(componentDef, {
    namedParams: true
  });

  const additionalStmts = Object.entries(statements).reduce(
    (acc, [key, sql]) => {
      acc[key] = world.db.prepare(sql);
      return acc;
    },
    {} as Record<string, Statement>
  );

  const def = {
    columns: result.columns,
    name,
    schema: componentDef, // Store the schema for default value access
    stmtInsert: world.db.prepare(sqlInsert),
    stmtUpdate: world.db.prepare(sqlUpdate),
    tableName: result.tableName,
    url: meta.id!,
    ...additionalStmts
  } as ComponentDef;

  // log.info('registered component def', {
  //   componentDef: {...componentDef.meta(), name},
  //   def
  // });

  world.defs.set(name, def);

  return world;
};

// export const insertComponentDef = <T extends Components>(world: World<T>, url: string): number => {
//   if (!world.db || !world.stmts.insertComponentDef) {
//     throw new Error('world not initialized');
//   }
//   const { lastInsertRowid } = world.stmts.insertComponentDef!.run(url);
//   return lastInsertRowid as number;
// }

export const flush = <T extends Components>(world: World<T>) => {
  const { db, defs, dirtyEntities, entitiesToDelete, entityCache, stmts } =
    world;
  db.transaction(() => {
    // Handle entity deletions first
    if (entitiesToDelete.size > 0) {
      // Convert Set to Array for SQL IN clause
      const entityIds = Array.from(entitiesToDelete);

      // Batch delete entities - components will be cascade deleted due to ON DELETE CASCADE
      const placeholders = entityIds
        .map((_, index) => `?${index + 1}`)
        .join(',');
      const deleteSql = `DELETE FROM tbl_entity WHERE id IN (${placeholders})`;

      world.db.exec(deleteSql, entityIds);

      // Clean up cache entries for deleted entities
      for (const eid of entityIds) {
        entityCache.delete(eid);
        dirtyEntities.delete(eid);
      }
    }

    // Handle component updates and insertions (only for entities that still exist)
    for (const [eid, components] of dirtyEntities.entries()) {
      // Skip if entity was deleted (cache should have been cleaned up above)
      if (!entityCache.has(eid)) {
        continue;
      }

      const cache = entityCache.get(eid);

      for (const c of components) {
        const entry = cache![c as string]!;
        const def = defs.get(c as string);
        if (!def) {
          // log.debug('[flush] defs', Object.keys(defs));
          throw new Error(`Component def not found for ${c as string}`);
        }

        // Skip components marked for deletion (they'll be handled in the next loop)
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
          // log.debug('[flush] insertData', insertData);
          def!.stmtInsert.run(insertData);
          entry.exists = true;
        }
      }
    }

    // Handle deferred component deletions
    for (const [eid, components] of dirtyEntities.entries()) {
      // Skip if entity was deleted
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
          // Component marked for deletion - delete from database
          const def = defs.get(c as string);
          if (def) {
            world.db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, eid);
            // Remove from cache
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
