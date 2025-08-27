import { Database } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteTable } from '../schema-to-sql';
import { createEntity, createWorld, flush, registerComponentDef, saveWorld } from '../world';
import { createLocation, getLocationE, locationSchema, type Location } from '../location';
import { createLog } from '@helpers/log';
import { addComponent } from '../component';


const log = createLog('test-main');



test('SQLite should be able to create a database', async () => {
  // const db = new Database(':memory:');
  // expect(db).toBeDefined();

  // const query = db.query("select 'Hello world' as message;");
  // const result = query.get();
  // expect(result).toEqual({ message: "Hello world" });

  // db.exec(`
  //   CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
  //   INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
  // `);

  const world = createWorld();

  const e = createEntity(world);
  console.log(e.id);

  registerComponentDef(world, locationSchema, {
    locationSelectByName: 'SELECT eid as id FROM tbl_locations WHERE name = ?1'
  });

  addComponent(e, 'location', {name: 'home', region: 'city'});

  // log.debug('world', world);

  flush(world);

  // log.debug('e', e);

  // createLocation(world, {name: 'home', region: 'city'});
  // createLocation(world, {name: 'warehouse', region: 'city'});

  // const home = getLocationE(world, {name: 'home'});
  // expect(home).not.toBeNull();

  // log.info('home', home);

  // const office = getLocationE(world, {name: 'office'});
  // expect(office).toBeNull();

  // // backup
  // saveWorld(world, './world.db');

  // const fileDb = new Database('mydatabase.sqlite');

  // const contents = db.serialize();
  // Database.deserialize(contents);
});



