import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';
import { createWorld } from '@world';

describe('World', () => {
  test('should create world with predefined components', async () => {
    const healthComponent = defineComponent({
      id: 'vitals',
      schema: {
        current: s.number(),
        max: s.number()
      }
    });

    const positionComponent = defineComponent({
      id: 'coords',
      schema: {
        x: s.number(),
        y: s.number()
      }
    });

    const world = await createWorld([healthComponent, positionComponent]);

    expect(world.componentTypes).toContain('vitals');
    expect(world.componentTypes).toContain('coords');
    expect(world.defs.size).toBe(2);
    expect(world.defs.has('vitals')).toBe(true);
    expect(world.defs.has('coords')).toBe(true);

    world.close();
  });

  test('should create entities and add components', async () => {
    const healthComponent = defineComponent({
      id: 'stats',
      schema: {
        current: s.number(),
        max: s.number()
      }
    });

    const nameComponent = defineComponent({
      id: 'identity',
      schema: {
        first: s.string(),
        last: s.string()
      }
    });

    const world = await createWorld([healthComponent, nameComponent]);
    const entity = world.create();

    // Test property assignment
    entity.stats = { current: 100, max: 100 };
    entity.identity = { first: 'John', last: 'Doe' };

    expect(entity.stats?.current).toBe(100);
    expect(entity.stats?.max).toBe(100);
    expect(entity.identity?.first).toBe('John');
    expect(entity.identity?.last).toBe('Doe');

    // Test modification
    entity.stats.current = 85;
    entity.identity.first = 'Jane';

    expect(entity.stats.current).toBe(85);
    expect(entity.identity.first).toBe('Jane');

    // Test persistence
    world.flush();

    // Test component removal
    entity.stats = undefined;
    expect(entity.stats).toBeUndefined();

    world.flush();
    world.close();
  });

  test('should handle multiple entities', async () => {
    const healthComponent = defineComponent({
      id: 'attributes',
      schema: {
        current: s.number(),
        max: s.number()
      }
    });

    const world = await createWorld([healthComponent]);

    const player1 = world.create();
    const player2 = world.create();

    player1.attributes = { current: 100, max: 100 };
    player2.attributes = { current: 50, max: 75 };

    expect(player1.id).not.toBe(player2.id);
    expect(player1.attributes?.current).toBe(100);
    expect(player2.attributes?.current).toBe(50);

    world.flush();
    world.close();
  });

  test('should work with statements in component definitions', async () => {
    const statsComponent = defineComponent({
      id: 'metrics',
      schema: {
        level: s.number(),
        xp: s.number()
      },
      statements: {
        byLevel: 'SELECT * FROM tbl_metrics WHERE level = ?1'
      }
    });

    const world = await createWorld([statsComponent]);

    // Verify the statement was registered
    const def = world.defs.get('metrics');
    expect(def).toBeDefined();
    // console.log('def', def);
    expect(def?.byLevel).toBeDefined();

    world.close();
  });

  test('component compatibility validation works', async () => {
    const health = defineComponent({
      id: 'health',
      schema: {
        current: s.number(),
        max: s.number()
      }
    });

    // create a temp file path
    const tempFile = Bun.file(`test-compatibility.db`);

    if (await tempFile.exists()) {
      tempFile.delete();
    }

    // Create initial world
    const world = await createWorld([health], { path: tempFile.name });

    const entity = world.create();
    entity.health = { current: 100, max: 100 };
    world.flush();
    world.close();

    // Try to load with a different component that uses the same table name
    const health2 = defineComponent({
      id: 'health',
      schema: {
        bonus: s.number(),
        current: s.number(),
        max: s.number()
      }
    });

    // This should fail because the table structure is incompatible

    await expect(
      createWorld([health2], {
        allowRedefineDefinitions: false,
        path: tempFile.name
      })
    ).rejects.toThrow(/Component definition compatibility check failed/);

    // Loading with the same original component should work
    const world2 = await createWorld([health], {
      path: tempFile.name
    });
    expect(world2).toBeTruthy();

    // Verify data is still there
    const results = world2.queryAll({ with: ['health'] });
    expect(results.length).toBeGreaterThan(0);

    world2.close();

    // Clean up
    if (await tempFile.exists()) {
      tempFile.delete();
    }
  });
});
