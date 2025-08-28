import { Database, Statement } from 'bun:sqlite';
import * as z from 'zod';

import { createLog } from '@helpers/log';

import { toSnakeCase } from './helpers/string';
import {
  zodSchemaToSqliteInsert,
  zodSchemaToSqliteTable,
  zodSchemaToSqliteUpdate
} from './schema/schema-to-sql';
import {
  entitySchema,
  type ComponentDef,
  type ComponentDefinition,
  type Components,
  type EntityCache,
  type SchemaType,
  type World,
  type WorldBuilder
} from './types';

const log = createLog('world');

// Helper function to convert object keys from camelCase to snake_case
const convertKeysToSnakeCase = (
  obj: Record<string, any>
): Record<string, any> => {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = toSnakeCase(key) || key;
    result[snakeKey] = value;
  }
  return result;
};

const createWorldInternal = <T extends Components>(): World<T> => {
  const dirtyEntities = new Map<number, Set<keyof Components>>();
  const entityCache: EntityCache = new Map();

  const db = new Database(':memory:', { strict: true });

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON');

  const { sql } = zodSchemaToSqliteTable(entitySchema, { ifNotExists: true });
  db.exec(sql);

  const insertEntity = db.prepare('INSERT INTO tbl_entity DEFAULT VALUES;');
  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?1;');
  const selectEntityById = db.prepare(
    'SELECT id FROM tbl_entity WHERE id = ?1;'
  );

  return {
    db,
    defs: new Map(),
    dirtyEntities,
    entityCache,
    flush: () => ({}) as unknown as World<T>,
    stmts: {
      deleteEntity,
      insertEntity,
      selectEntityById
    }
  };
};

export const createWorld = <T extends Components>(): WorldBuilder<T> => {
  const world = createWorldInternal<T>();

  const build = () => ({ ...world, flush: () => flush(world) });

  const registerComponent = <Name extends string, Schema extends SchemaType>(
    def: ComponentDefinition<Name, Schema>
  ): WorldBuilder<T> => {
    registerComponentDef(world, def.schema, def.statements || {});
    return {
      ...world,
      build,
      registerComponent
    } as WorldBuilder<T & { [K in Name]: z.infer<Schema> }>;
  };

  return {
    ...world,
    build,
    registerComponent
  };
};

// export const getComponentDef = <T extends Components>(world: World<T>, url: string) => {
//   const stmt = world.stmts.selectComponentDefByUrl;
//   if (!stmt) {
//     throw new Error('selectComponentDefByUrl not found');
//   }
//   return stmt.get(url);
// }

export const saveWorld = async <T extends Components>(
  world: World<T>,
  path: string
) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  world.db.exec(`VACUUM main INTO '${path}'`);
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
  const name = meta.id;

  const existing = world.defs.get(name);
  if (existing) {
    return world;
  }

  // log.debug('[registerComponentDef] name', name, meta.id);

  // const cid = insertComponentDef(world, meta.id);

  const result = zodSchemaToSqliteTable(componentDef, { ifNotExists: true });
  // log.debug('[registerComponentDef] result', result);
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef, {
    namedParams: true
  });
  const sqlUpdate = zodSchemaToSqliteUpdate(componentDef, {
    namedParams: true
  });

  // log.debug('[registerComponentDef] sqlInsert', name, sqlInsert);
  // log.debug('[registerComponentDef] sqlUpdate', name, sqlUpdate);

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
  const { db, defs, dirtyEntities, entityCache, stmts } = world;
  db.transaction(() => {
    for (const [eid, components] of dirtyEntities.entries()) {
      const cache = entityCache.get(eid);

      for (const c of components) {
        const entry = cache![c as string]!;
        const def = defs.get(c as string);
        if (!def) {
          log.debug('[flush] defs', Object.keys(defs));
          throw new Error(`Component def not found for ${c as string}`);
        }
        if (entry.exists) {
          // update
          const updateData = convertKeysToSnakeCase({ ...entry.data, eid });
          // log.debug('[flush] update', updateData, eid);
          def!.stmtUpdate.run(updateData);
        } else {
          // insert
          const insertData = convertKeysToSnakeCase({ ...entry.data, eid });
          // log.debug('[flush] insert', insertData, def.url);
          def!.stmtInsert.run(insertData);
          entry.exists = true;
        }
      }
    }
  })();

  dirtyEntities.clear();

  return world;
};
