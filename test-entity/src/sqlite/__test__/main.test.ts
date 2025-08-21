import { Database } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import * as z from "zod";
import { zodSchemaToSqliteTable } from '../schema-to-sql';
import { createEntity, createWorld, saveWorld } from '../world';
import { createLocation } from '../location';






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

  const eid = createEntity(world);
  console.log(eid);

  createLocation(world, {name: 'home', region: 'city'});
  createLocation(world, {name: 'warehouse', region: 'city'});

  // backup
  saveWorld(world, './world.db');

  // const fileDb = new Database('mydatabase.sqlite');

  // const contents = db.serialize();
  // Database.deserialize(contents);
});



