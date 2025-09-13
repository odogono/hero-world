/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineComponent, getComponentTableName } from '../component';
import {
  compareComponentHashes,
  hashComponentDefinition
} from '../schema/component-hash';
import {
  getStoredComponentMetadata,
  validateComponentCompatibility
} from '../schema/component-metadata';
import { createWorld, loadWorld } from '../world';

describe('Component Compatibility System', () => {
  const testDbPath = './test-compatibility.db';

  // Clean up test database after each test
  const cleanup = async () => {
    try {
      if (await Bun.file(testDbPath).exists()) {
        await Bun.file(testDbPath).delete();
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  test('should hash component definitions consistently', () => {
    const playerComponent = defineComponent({
      name: 'player',
      schema: {
        name: z.string(),
        level: z.number(),
        health: z.number().default(100)
      }
    });

    // Same component definition should produce same hash
    const hash1 = hashComponentDefinition(playerComponent);
    const hash2 = hashComponentDefinition(playerComponent);
    expect(hash1).toBe(hash2);

    // Different component should produce different hash
    const enemyComponent = defineComponent({
      name: 'enemy',
      schema: {
        name: z.string(),
        level: z.number(),
        health: z.number().default(50)
      }
    });

    const hash3 = hashComponentDefinition(enemyComponent);
    expect(hash1).not.toBe(hash3);
  });

  test('should detect compatible vs incompatible component changes', () => {
    const originalComponent = defineComponent({
      name: 'stats1',
      tableName: 'tbl_stats',
      schema: {
        health: z.number(),
        mana: z.number()
      }
    });

    const modifiedComponent = defineComponent({
      name: 'stats2',
      tableName: 'tbl_stats',
      schema: {
        health: z.number(),
        mana: z.number(),
        stamina: z.number().optional() // Adding optional field
      }
    });

    expect(getComponentTableName(modifiedComponent)).toBe('tbl_stats');

    const originalHash = hashComponentDefinition(originalComponent);
    const modifiedHash = hashComponentDefinition(modifiedComponent);

    const comparison = compareComponentHashes(
      { tbl_name: 'tbl_stats', hash: originalHash },
      {
        tbl_name: 'tbl_stats',
        hash: modifiedHash,
        definition: modifiedComponent
      }
    );

    expect(comparison.compatible).toBe(false);
    expect(comparison.differences).toContain(
      `Component table 'tbl_stats' definition has changed`
    );
  });

  test('should create world with component metadata', async () => {
    await cleanup();

    const playerComponent = defineComponent({
      name: 'player1',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const world = await createWorld([playerComponent], {
      path: testDbPath
    });

    // Check that metadata was stored
    const metadata = getStoredComponentMetadata(world.db);

    expect(metadata).toHaveLength(1);
    expect(metadata[0]!.tbl_name).toBe('tbl_player_1');
    expect(metadata[0]!.hash).toBeTruthy();

    world.close();
    await cleanup();
  });

  test('should validate compatible components on world reload', async () => {
    await cleanup();

    const playerComponent = defineComponent({
      name: 'player2',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    // Create initial world
    const world1 = await createWorld([playerComponent], {
      path: testDbPath
    });
    world1.close();

    // Reload with same components should work
    const world2 = await loadWorld([playerComponent], testDbPath);
    expect(world2).toBeTruthy();

    world2.close();
    await cleanup();
  });

  test('should reject incompatible components on world reload', async () => {
    await cleanup();

    const originalComponent = defineComponent({
      name: 'player3',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    // Create initial world
    const world1 = await createWorld([originalComponent], {
      path: testDbPath
    });
    world1.close();

    const modifiedComponent = defineComponent({
      name: 'player3modified',
      tableName: 'tbl_player_3',
      schema: {
        name: z.string(),
        level: z.number(),
        experience: z.number()
      }
    });

    await expect(loadWorld([modifiedComponent], testDbPath)).rejects.toThrow(
      /Component definition compatibility check failed/
    );

    await cleanup();
  });

  test('should handle component additions and removals', async () => {
    await cleanup();

    const playerComponent = defineComponent({
      name: 'player5',
      schema: {
        name: z.string(),
        level: z.number()
      }
    });

    const inventoryComponent = defineComponent({
      name: 'inventory1',
      schema: {
        capacity: z.number(),
        items: z.array(z.string()).default([])
      }
    });

    // Create world with just player component
    const world1 = await createWorld([playerComponent], {
      path: testDbPath
    });
    world1.close();

    // Add inventory component - should work but show warning
    const world2 = await loadWorld(
      [playerComponent, inventoryComponent],
      testDbPath
    );
    expect(world2).toBeTruthy();
    world2.close();

    // Remove inventory component - should work but show warning
    const world3 = await loadWorld([playerComponent], testDbPath);
    expect(world3).toBeTruthy();
    world3.close();

    await cleanup();
  });

  test('should provide detailed validation results', async () => {
    await cleanup();

    const originalComponent = defineComponent({
      name: 'stats3',
      tableName: 'tbl_stats',
      schema: {
        health: z.number(),
        mana: z.number()
      }
    });

    // Create world
    const world = await createWorld([originalComponent], {
      path: testDbPath
    });

    // Test validation directly
    const modifiedComponent = defineComponent({
      name: 'stats3modified',
      tableName: 'tbl_stats',
      schema: {
        health: z.number(),
        power: z.number() // Changed mana to power
      }
    });

    const validation = validateComponentCompatibility(world.db, [
      modifiedComponent
    ]);

    expect(validation.compatible).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.join(' ')).toContain('tbl_stats');

    world.close();
    await cleanup();
  });
});
