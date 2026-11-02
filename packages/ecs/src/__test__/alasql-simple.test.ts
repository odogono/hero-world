import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '../db';
import { createWorld } from '../world';

describe.skip('AlasQL ECS Integration', () => {
  test('should create AlasQL world successfully', async () => {
    const world = await createWorld([], { dbType: DatabaseType.ALASQL });
    expect(world).toBeDefined();
    expect(world.db).toBeDefined();
    expect(world.flush).toBeFunction();

    world.db.close();
  });

  test('should handle basic database operations', async () => {
    const world = await createWorld([], { dbType: DatabaseType.ALASQL });

    // Test that we can execute basic SQL commands
    world.db.exec('CREATE TABLE simple_test (id INT, name STRING)');
    world.db.exec('INSERT INTO simple_test VALUES (1, "test")');

    const results = world.db.query('SELECT * FROM simple_test');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });

    world.db.close();
  });

  test('should handle entity table creation', async () => {
    const world = await createWorld([], { dbType: DatabaseType.ALASQL });

    // Verify that the tbl_entity table was created successfully
    const entityResults = world.db.query('SELECT * FROM tbl_entity');
    expect(Array.isArray(entityResults)).toBe(true);

    world.db.close();
  });
});
