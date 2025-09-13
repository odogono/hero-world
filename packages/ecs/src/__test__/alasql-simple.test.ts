import { describe, expect, test } from 'bun:test';

import { createWorld } from '@/world';
import { DatabaseType } from '@db';

describe('AlasQL ECS Integration', () => {
  test('should create AlasQL world successfully', async () => {
    const world = await createWorld({ dbType: DatabaseType.ALASQL });
    expect(world).toBeDefined();
    expect(world.build).toBeFunction();

    const builtWorld = world.build();
    expect(builtWorld.db).toBeDefined();
    expect(builtWorld.flush).toBeFunction();

    builtWorld.db.close();
  });

  test('should handle basic database operations', async () => {
    const world = await createWorld({ dbType: DatabaseType.ALASQL });
    const builtWorld = world.build();

    // Test that we can execute basic SQL commands
    builtWorld.db.exec('CREATE TABLE simple_test (id INT, name STRING)');
    builtWorld.db.exec('INSERT INTO simple_test VALUES (1, "test")');

    const results = builtWorld.db.query('SELECT * FROM simple_test');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: 1, name: 'test' });

    builtWorld.db.close();
  });

  test('should handle entity table creation', async () => {
    const world = await createWorld({ dbType: DatabaseType.ALASQL });
    const builtWorld = world.build();

    // Verify that the tbl_entity table was created successfully
    const entityResults = builtWorld.db.query('SELECT * FROM tbl_entity');
    expect(Array.isArray(entityResults)).toBe(true);

    builtWorld.db.close();
  });
});
