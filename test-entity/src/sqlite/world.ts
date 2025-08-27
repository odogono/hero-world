import { Database, Statement } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteInsert, zodSchemaToSqliteTable, zodSchemaToSqliteUpdate, type ColumnInfo } from './schema-to-sql';
import { createLog } from '@helpers/log';
import { fromUrl, toCamelCase } from '../helpers/string';
import type { Location } from './location';
import { componentDefSchema, entitySchema, type Components, type Entity } from './types';
import { makeTrackedComponent } from './component';


type ComponentCacheEntry<T> = {
  data: T;
  exists: boolean;
}


type EntityCache = Map<number, Partial<{
  [K in keyof Components]: ComponentCacheEntry<Components[K]>
}>>;


type ComponentDef = {
  url: string;
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  stmtInsert: Statement;
  stmtUpdate: Statement;
} & {
  [key: string]: Statement;
}

export type World = {
  db: Database;
  dirtyEntities: Map<number, Set<keyof Components>>;
  entityCache: EntityCache;
  defs: Map<string, ComponentDef>;
  stmts: {
    [key: string]: Statement;
  }
}

const log = createLog('world');



export const createWorld = (): World => {

  const dirtyEntities = new Map<number, Set<keyof Components>>();
  const entityCache: EntityCache = new Map();

  const db = new Database(':memory:', { strict: true});

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON");

  const {sql} = zodSchemaToSqliteTable(entitySchema, {ifNotExists: true});
  db.exec(sql);

  const {sql: componentDefSql} = zodSchemaToSqliteTable(componentDefSchema, {ifNotExists: true});
  db.exec(componentDefSql);

  const insertEntity = db.prepare('INSERT INTO tbl_entity DEFAULT VALUES;');
  const deleteEntity = db.prepare('DELETE FROM tbl_entity WHERE id = ?1;');
  const selectEntityById = db.prepare('SELECT id FROM tbl_entity WHERE id = ?1;');
  const insertComponentDef = db.prepare('INSERT INTO tbl_component_def (url) VALUES (?1) ON CONFLICT DO NOTHING;');
  const selectComponentDefByUrl = db.prepare('SELECT id FROM tbl_component_def WHERE url = ?1;');
  return {
    db,
    defs: new Map(),
    dirtyEntities,
    entityCache,
    stmts: {
      insertEntity,
      deleteEntity,
      selectEntityById,
      insertComponentDef,
      selectComponentDefByUrl
    }
  }
}

export const getComponentDef = (world: World, url: string) => {
  const stmt = world.stmts.selectComponentDefByUrl;
  if (!stmt) {
    throw new Error('selectComponentDefByUrl not found');
  }
  return stmt.get(url);
}


export const saveWorld = async (world: World, path: string) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  world.db.exec(`VACUUM main INTO '${path}'`);
}


interface ComponentStatements {
  [key: string]: string;
}

export const registerComponentDef = (world: World, componentDef: z.ZodObject<any>, statements: ComponentStatements): World => {

  const meta = componentDef.meta();

  if (!meta?.id) {
    throw new Error('componentDef must have an id');
  }

  const existing = getComponentDef(world, meta.id);
  if (existing) {
    return world;
  }

  const name = fromUrl(meta.id);

  log.debug('[registerComponentDef] name', name, meta.id);

  const cid = insertComponentDef(world, meta.id);
  
  const result = zodSchemaToSqliteTable(componentDef, {ifNotExists: true});
  log.debug('[registerComponentDef] result', result);
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef, {namedParams: true});
  const sqlUpdate = zodSchemaToSqliteUpdate(componentDef, {namedParams: true});

  log.debug('[registerComponentDef] sqlInsert', name, sqlInsert);
  log.debug('[registerComponentDef] sqlUpdate', name, sqlUpdate);
  
  const additionalStmts = Object.entries(statements).reduce((acc, [key, sql]) => {
    acc[key] = world.db.prepare(sql);
    return acc;
  }, {} as Record<string, Statement>);

  const def = {
    url: meta.id!,
    name,
    tableName: result.tableName,
    columns: result.columns,
    stmtInsert: world.db.prepare(sqlInsert),
    stmtUpdate: world.db.prepare(sqlUpdate),
    ...additionalStmts
  } as ComponentDef;

  // log.info('registered component def', {
  //   componentDef: {...componentDef.meta(), name},
  //   def
  // });

  world.defs.set(name, def);
  
  return world;
}


export const createEntity = <C extends keyof Components>(world: World, initialComponents?: Partial<Pick<Components, C>>): Entity<C> => {
  const eid = world.stmts.insertEntity!.run().lastInsertRowid as number;
  
  const entity: any = { id: eid, world };
  
  world.entityCache.set(eid, {});
  if (initialComponents) {
    for (const [c, data] of Object.entries(initialComponents)) {
      const name = c as keyof Components;
      if (data ) {
        entity[name] = makeTrackedComponent(entity, name, {...data} as any, false);

        if (!world.dirtyEntities.has(eid)) {
          world.dirtyEntities.set(eid, new Set());
        }
        world.dirtyEntities.get(eid)!.add(name);
      }
    }
  }
  return entity as Entity<C>;
}

export const insertComponentDef = (world: World, url: string) => {
  if (!world.db || !world.stmts.insertComponentDef) {
    throw new Error('world not initialized');
  }
  const { lastInsertRowid } = world.stmts.insertComponentDef!.run(url);
  return lastInsertRowid as number;
}

export const deleteEntity = (entity: Entity) => {
  const { id, world } = entity;

  log.debug('[deleteEntity] foreign_keys', world.db.query('PRAGMA foreign_keys').get());
  
  world.stmts.deleteEntity!.run(id);

  // Clean up caches
  world.entityCache.delete(id);
  world.dirtyEntities.delete(id);

  return null;
}

export const getEntity = (world: World, id: number) => {
  const stmt = world.stmts.selectEntityById;
  if (!stmt) {
    throw new Error('selectEntityById not found');
  }
  const eid = stmt.get(id);

  return eid ? { id: eid, world } as Entity<any> : null;
}


export const queryEntities = (world: World, components: (keyof Components)[], entity?: Entity) => {

  const base = `SELECT e.id AS eid`;
  const joins: string[] = [];
  const fields: string[] = [];

  components.forEach(c => {
    const def = world.defs.get(c);
    if (!def) {
      throw new Error(`Component def not found for ${c}`);
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

  const where = entity ? `WHERE e.id = ${entity.id}` : '';

  // TODO cache sql against components
  const sql = `${base}, ${fields.join(', ')}\nFROM tbl_entity AS e\n${joins.join('\n')}\n${where}`;
  const stmt = world.db.query(sql);
  const rows = stmt.all();

  return rows.map((row: any) => {
    const entity: Entity<any> = { id: row.eid, world };
    
    components.forEach(c => {
      const def = world.defs.get(c)!;
      const data: any = {};
      def.columns.forEach(column => {
        data[column.name] = row[`${def.name}_${column.name}`];
      })
      entity[c] = makeTrackedComponent(entity, c, data);
    });

    return entity;
  });
}


export const flush = (world: World) => {
  const { db, defs, dirtyEntities, entityCache, stmts } = world;
  db.transaction(() => {
    
    for (const [eid, components] of dirtyEntities.entries()) {
      const cache = entityCache.get(eid);

      for (const c of components) {
        const entry = cache![c]!;
        const def = defs.get(c);
        if (!def) {
          log.debug('[flush] defs', Object.keys(defs));
          throw new Error(`Component def not found for ${c}`);
        }
        if (entry.exists) {
          // update
          log.debug('[flush] update', entry.data, eid);
          def!.stmtUpdate.run(entry.data);
          // stmts[c]!.run(eid, entry.data);
        } else {
          // insert
          const data = {...entry.data, eid};
          log.debug('[flush] insert', data, def.url);
          def!.stmtInsert.run(data);
          entry.exists = true;
        }
      }
    }


  })();

  dirtyEntities.clear();
}