import { Database, Statement } from 'bun:sqlite';
import * as z from "zod";
import { zodSchemaToSqliteInsert, zodSchemaToSqliteTable, zodSchemaToSqliteUpdate } from './schema-to-sql';
import { createLog } from '@helpers/log';
import { fromUrl, toSnakeCase } from '../helpers/string';
import type { Components, Entity, World, EntityCache, ComponentDef, WorldBuilder } from './types';
import { entitySchema } from './types';
import type { ComponentDefinition } from './types';
import { makeTrackedComponent } from './component';




const log = createLog('world');

// Helper function to convert object keys from camelCase to snake_case
const convertKeysToSnakeCase = (obj: Record<string, any>): Record<string, any> => {
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

  const db = new Database(':memory:', { strict: true});

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON");

  const {sql} = zodSchemaToSqliteTable(entitySchema, {ifNotExists: true});
  db.exec(sql);

  
  const insertEntity = db.prepare('INSERT INTO tbl_entity DEFAULT VALUES;');
  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?1;');
  const selectEntityById = db.prepare('SELECT id FROM tbl_entity WHERE id = ?1;');
  

  return {
    db,
    defs: new Map(),
    dirtyEntities,
    entityCache,
    stmts: {
      deleteEntity,
      insertEntity,
      selectEntityById,
  
    }
  }
}


// Cleaner component registration using ComponentDefinition
// export const registerComponent = <
//   Name extends string,
//   Schema extends z.ZodObject<any>
// >(
//   world: World<T & { [K in Name]: z.infer<Schema> }>, 
//   definition: ComponentDefinition<Name, Schema>
// ): World<T & { [K in Name]: z.infer<Schema> }> => {
//   return registerComponentDef(world, definition.schema, definition.statements || {});
// }

export const createWorld = <T extends Components>(): WorldBuilder<T> => {
  const world = createWorldInternal<T>();

  const build = () => world;

  const registerComponent = <Name extends string, Schema extends z.ZodObject<any>>(def: ComponentDefinition<Name, Schema>): WorldBuilder<T> => {
    registerComponentDef(world, def.schema, def.statements || {});
    return {
      ...world,
      build,
      registerComponent
    } as WorldBuilder<T & { [K in Name]: z.infer<Schema> }>;
  }


  return {
    ...world,
    build,
    registerComponent
  };
}

// export const getComponentDef = <T extends Components>(world: World<T>, url: string) => {
//   const stmt = world.stmts.selectComponentDefByUrl;
//   if (!stmt) {
//     throw new Error('selectComponentDefByUrl not found');
//   }
//   return stmt.get(url);
// }


export const saveWorld = async <T extends Components>(world: World<T>, path: string) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  world.db.exec(`VACUUM main INTO '${path}'`);
}


type ComponentStatements = {
  [key: string]: string;
}

const registerComponentDef = <T extends Components>(world: World<T>, componentDef: z.ZodObject<any>, statements: ComponentStatements = {}): World<T> => {

  const meta = componentDef.meta();

  if (!meta?.id) {
    throw new Error('componentDef must have an id');
  }
  const name = fromUrl(meta.id);

  const existing = world.defs.get(name);
  if (existing) {
    return world;
  }


  // log.debug('[registerComponentDef] name', name, meta.id);

  // const cid = insertComponentDef(world, meta.id);
  
  const result = zodSchemaToSqliteTable(componentDef, {ifNotExists: true});
  // log.debug('[registerComponentDef] result', result);
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef, {namedParams: true});
  const sqlUpdate = zodSchemaToSqliteUpdate(componentDef, {namedParams: true});

  // log.debug('[registerComponentDef] sqlInsert', name, sqlInsert);
  // log.debug('[registerComponentDef] sqlUpdate', name, sqlUpdate);
  
  const additionalStmts = Object.entries(statements).reduce((acc, [key, sql]) => {
    acc[key] = world.db.prepare(sql);
    return acc;
  }, {} as Record<string, Statement>);

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
}


// export const insertComponentDef = <T extends Components>(world: World<T>, url: string): number => {
//   if (!world.db || !world.stmts.insertComponentDef) {
//     throw new Error('world not initialized');
//   }
//   const { lastInsertRowid } = world.stmts.insertComponentDef!.run(url);
//   return lastInsertRowid as number;
// }

export const deleteEntity = <T extends Components>(entity: Entity<any>) => {
  const { id, world } = entity;

  // log.debug('[deleteEntity] foreign_keys', world.db.query('PRAGMA foreign_keys').get());
  
  world.stmts.deleteEntity!.run(id);

  // Clean up caches
  world.entityCache.delete(id);
  world.dirtyEntities.delete(id);

  return null;
}

export const getEntity = <T extends Components>(world: World<T>, id: number) => {
  const stmt = world.stmts.selectEntityById;
  if (!stmt) {
    throw new Error('selectEntityById not found');
  }
  const eid = stmt.get(id);

  return eid ? { id: eid, world } as Entity<any> : null;
}


export const queryEntities = <T extends Components>(world: World<T>, components: (keyof T)[], entity?: Entity<any>) => {

  const base = `SELECT e.id AS eid`;
  const joins: string[] = [];
  const fields: string[] = [];
  components.forEach(c => {
    const def = world.defs.get(c as string);
    if (!def) {
      throw new Error(`Component def not found for ${String(c)}`);
    }
    const alias = def.name;
    const join = `JOIN ${def.tableName} AS ${alias} ON ${alias}.eid = e.id`;
    joins.push(join);
    def.columns.forEach(column => {
      const name = column.name;
      const field = `${alias}.${name} AS ${alias}_${name}`;
      fields.push(field);
    });
  });

  const where = entity ? `WHERE e.id = ${entity.id} LIMIT 1` : '';

  // TODO cache sql against components
  const sql = `${base}, ${fields.join(', ')}\nFROM tbl_entity AS e\n${joins.join('\n')}\n${where}`;
  const stmt = world.db.query(sql);
  const rows = stmt.all();

  return rows.map((row: any) => {
    const entity: Entity<any> = { id: row.eid, world } as Entity<any>;
    
    components.forEach(c => {
      const def = world.defs.get(c as string)!;
      const data: any = {};
      def.columns.forEach(column => {
        data[column.name] = row[`${def.name}_${column.name}`];
      })
      entity[c] = makeTrackedComponent(entity, c as string, data);
    });

    return entity;
  });
}


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
          const updateData = convertKeysToSnakeCase({...entry.data, eid});
          // log.debug('[flush] update', updateData, eid);
          def!.stmtUpdate.run(updateData);
        } else {
          // insert
          const insertData = convertKeysToSnakeCase({...entry.data, eid});
          // log.debug('[flush] insert', insertData, def.url);
          def!.stmtInsert.run(insertData);
          entry.exists = true;
        }
      }
    }


  })();

  dirtyEntities.clear();
}