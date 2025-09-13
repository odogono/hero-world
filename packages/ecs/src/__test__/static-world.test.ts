import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';
import { createEntity } from '@entity';
import { createWorld } from '@world';

describe('Static World', () => {
  test('should create static world with predefined components', async () => {
    const healthComponent = defineComponent({
      name: 'vitals',
      schema: {
        current: z.number(),
        max: z.number()
      }
    });

    const positionComponent = defineComponent({
      name: 'coords',
      schema: {
        x: z.number(),
        y: z.number()
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
      name: 'stats',
      schema: {
        current: z.number(),
        max: z.number()
      }
    });

    const nameComponent = defineComponent({
      name: 'identity',
      schema: {
        first: z.string(),
        last: z.string()
      }
    });

    const world = await createWorld([healthComponent, nameComponent]);
    const entity = createEntity(world);

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
      name: 'attributes',
      schema: {
        current: z.number(),
        max: z.number()
      }
    });

    const world = await createWorld([healthComponent]);

    const player1 = createEntity(world);
    const player2 = createEntity(world);

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
      name: 'metrics',
      schema: {
        level: z.number(),
        xp: z.number()
      },
      statements: {
        byLevel: 'SELECT * FROM tbl_metrics WHERE level = ?1'
      }
    });

    const world = await createWorld([statsComponent]);

    // Verify the statement was registered
    const def = world.defs.get('metrics');
    expect(def).toBeDefined();
    expect(def?.byLevel).toBeDefined();

    world.close();
  });
});
