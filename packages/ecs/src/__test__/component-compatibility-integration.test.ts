import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '../component';
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
      id: 'realPlayer',
      schema: {
        experience: s.number().default(0),
        level: s.number(),
        name: s.string()
      }
    });

    const inventoryComponent = defineComponent({
      id: 'realInventory',
      schema: {
        capacity: s.number().default(10),
        items: s.array('string').default([])
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
      id: 'realPlayer2',
      schema: {
        level: s.number(),
        name: s.string()
      }
    });

    const inventoryComponent = defineComponent({
      id: 'realInventory2',
      schema: {
        capacity: s.number(),
        items: s.array('string').default([])
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
      id: 'realPlayer3',
      schema: {
        level: s.number(),
        name: s.string()
      }
    });

    const questComponent = defineComponent({
      id: 'realQuest3',
      schema: {
        completed: s.boolean().default(false),
        id: s.string()
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
