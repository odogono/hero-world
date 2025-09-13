import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '../component';
import { createWorld, loadWorld } from '../world';

describe('Component Compatibility Integration Tests', () => {
  const testDbPath = './test-integration-compatibility.db';

  const cleanup = async () => {
    try {
      if (await Bun.file(testDbPath).exists()) {
        await Bun.file(testDbPath).delete();
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  test('real world scenario: create world, save, load with same components', async () => {
    await cleanup();

    // Define original components
    const playerComponent = defineComponent({
      name: 'realPlayer',
      schema: {
        experience: z.number().default(0),
        level: z.number(),
        name: z.string()
      }
    });

    const inventoryComponent = defineComponent({
      name: 'realInventory',
      schema: {
        capacity: z.number().default(10),
        items: z.array(z.string()).default([])
      }
    });

    // Create world with components
    const world1 = await createWorld([playerComponent, inventoryComponent], {
      path: testDbPath
    });

    // The world should be created successfully
    expect(world1).toBeTruthy();
    world1.close();

    // Load world with same components - should work
    const world2 = await loadWorld(
      [playerComponent, inventoryComponent],
      testDbPath
    );
    expect(world2).toBeTruthy();
    world2.close();

    await cleanup();
  });

  test('real world scenario: attempt to load with missing component should warn', async () => {
    await cleanup();

    const playerComponent = defineComponent({
      name: 'realPlayer2',
      schema: {
        level: z.number(),
        name: z.string()
      }
    });

    const inventoryComponent = defineComponent({
      name: 'realInventory2',
      schema: {
        capacity: z.number(),
        items: z.array(z.string()).default([])
      }
    });

    // Create world with both components
    const world1 = await createWorld([playerComponent, inventoryComponent], {
      path: testDbPath
    });
    world1.close();

    // Try to load with only player component (missing inventory)
    // This should work but show warnings
    const world2 = await loadWorld([playerComponent], testDbPath);
    expect(world2).toBeTruthy();
    world2.close();

    await cleanup();
  });

  test('real world scenario: load with additional component should warn', async () => {
    await cleanup();

    const playerComponent = defineComponent({
      name: 'realPlayer3',
      schema: {
        level: z.number(),
        name: z.string()
      }
    });

    const questComponent = defineComponent({
      name: 'realQuest3',
      schema: {
        completed: z.boolean().default(false),
        id: z.string()
      }
    });

    // Create world with just player component
    const world1 = await createWorld([playerComponent], {
      path: testDbPath
    });
    world1.close();

    // Load with additional quest component - should work with warnings
    const world2 = await loadWorld(
      [playerComponent, questComponent],
      testDbPath
    );
    expect(world2).toBeTruthy();
    world2.close();

    await cleanup();
  });
});
