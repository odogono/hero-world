import { Database, Statement } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteInsert, zodSchemaToSqliteTable } from './schema-to-sql';
import { createLog } from '@helpers/log';
import { fromUrl } from '../helpers/string';

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
}).meta({ name: 'tbl_entities' });



export const createWorld = () => {

  const db = new Database(':memory:');

  const {sql} = zodSchemaToSqliteTable(entitySchema, {ifNotExists: true});
  db.exec(sql);

  const insertEntity = db.prepare('INSERT INTO tbl_entities DEFAULT VALUES;');

  return {
    db,
    stmts: {
      insertEntity
    }
  }
}


export const saveWorld = async (world: World, path: string) => {
  if (await Bun.file(path).exists()) {
    await Bun.file(path).delete();
  }
  world.db.exec(`VACUUM main INTO '${path}'`);
}

export const registerComponentDef = (world: World, componentDef: z.ZodObject<any>): World => {

  const meta = componentDef.meta();

  if (!meta?.id) {
    throw new Error('componentDef must have an id');
  }

  const name = fromUrl(meta.id);
  
  const result = zodSchemaToSqliteTable(componentDef, {ifNotExists: true});
  world.db.exec(result.sql);

  const sqlInsert = zodSchemaToSqliteInsert(componentDef);
  world.db.prepare(sqlInsert);

  log.info('registered component def', {
    
    componentDef: {...componentDef.meta(), name},
    sqlInsert
  });

  const insertKey = `insert${name}`;

  return {
    ...world,
    stmts: {
      ...world.stmts,
      [insertKey]: world.db.prepare(sqlInsert)
    }
  }
}


export const createEntity = (world: World) => {
  if (!world.db || !world.stmts.insertEntity) {
    throw new Error('world not initialized');
  }
  
  const { lastInsertRowid } = world.stmts.insertEntity!.run();
  return lastInsertRowid as number;
}