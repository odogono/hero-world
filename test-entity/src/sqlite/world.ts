import { Database, Statement } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteInsert, zodSchemaToSqliteTable } from './schema-to-sql';
import { createLog } from '@helpers/log';
import { fromUrl, toCamelCase } from '../helpers/string';

export type World = {
  db: Database;
  stmts: {
    [key: string]: Statement;
  }
}

const log = createLog('world');


export type Entity = z.infer<typeof entitySchema>;
const entitySchema = z.object({
  id: z.number().meta({ primaryKey: true, autoIncrement: true }),
  createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
  updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
}).meta({ name: 'tbl_entity' });

export type ComponentDef = z.infer<typeof componentDefSchema>;
const componentDefSchema = z.object({
  id: z.string().meta({ primaryKey: true, autoIncrement: true }),
  url: z.string().meta({ unique: true }),
}).meta({ name: 'tbl_component_def' });


export const isEntity = (val: unknown): val is Entity => {
  if (typeof val !== 'object' || val === null) return false;
  const entity = val as Partial<Entity>;
  return typeof entity.id === 'number';
}

export const createWorld = () => {

  const db = new Database(':memory:');

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON");

  const {sql} = zodSchemaToSqliteTable(entitySchema, {ifNotExists: true});
  db.exec(sql);

  const {sql: componentDefSql} = zodSchemaToSqliteTable(componentDefSchema, {ifNotExists: true});
  db.exec(componentDefSql);

  const insertEntity = db.prepare('INSERT INTO tbl_entity DEFAULT VALUES;');
  const insertComponentDef = db.prepare('INSERT INTO tbl_component_def (url) VALUES (?1) ON CONFLICT DO NOTHING;');
  const selectComponentDefByUrl = db.prepare('SELECT id FROM tbl_component_def WHERE url = ?1;');
  return {
    db,
    stmts: {
      insertEntity,
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

  const cid = insertComponentDef(world, meta.id);
  
  const result = zodSchemaToSqliteTable(componentDef, {ifNotExists: true});
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef);
  

  log.info('registered component def', {
    
    componentDef: {...componentDef.meta(), name},
    sqlInsert
  });

  const insertKey = `${toCamelCase(name)}Insert`;
  const stmts = {
    ...world.stmts,
    [insertKey]: world.db.prepare(sqlInsert)
  }


  for (const [key, sql] of Object.entries(statements)) {
    const stmt = world.db.prepare(sql);
    stmts[key] = stmt;
    log.info('registered component stmt', {
      key,
      sql
    });
  }

  world.stmts = stmts;

  return {
    ...world,
    stmts
  }
}


export const createEntity = (world: World) => 
  world.stmts.insertEntity!.run().lastInsertRowid as number;

export const insertComponentDef = (world: World, url: string) => {
  if (!world.db || !world.stmts.insertComponentDef) {
    throw new Error('world not initialized');
  }
  const { lastInsertRowid } = world.stmts.insertComponentDef!.run(url);
  return lastInsertRowid as number;
}