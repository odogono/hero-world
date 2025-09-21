/* eslint-disable perfectionist/sort-objects */
import { afterEach, describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';

import {
  compareComponentHashes,
  hashComponentDefinition
} from '../schema/component-hash';
import { getStoredComponentMetadata } from '../schema/component-metadata';
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

  afterEach(async () => {
    await cleanup();
  });

  test('should hash component definitions consistently', () => {
    const playerComponent = defineComponent({
      id: 'player',
      schema: {
        name: s.string(),
        level: s.number(),
        health: s.number().default(100)
      }
    });

    // Same component definition should produce same hash
    const hash1 = hashComponentDefinition(playerComponent);
    const hash2 = hashComponentDefinition(playerComponent);
    expect(hash1).toBe(hash2);

    // Different component should produce different hash
    const enemyComponent = defineComponent({
      id: 'enemy',
      schema: {
        name: s.string(),
        level: s.number(),
        health: s.number().default(50)
      }
    });

    const hash3 = hashComponentDefinition(enemyComponent);
    expect(hash1).not.toBe(hash3);
  });

  test('should detect compatible vs incompatible component changes', () => {
    const originalComponent = defineComponent({
      id: 'stats',
      schema: {
        health: s.number(),
        mana: s.number()
      }
    });

    const modifiedComponent = defineComponent({
      id: 'stats',
      schema: {
        health: s.number(),
        mana: s.number(),
        stamina: s.number().optional() // Adding optional field
      }
    });

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
    const playerComponent = defineComponent({
      id: 'player1',
      schema: {
        name: s.string(),
        level: s.number()
      }
    });

    const world = await createWorld([playerComponent], {
      path: testDbPath
    });

    // Check that metadata was stored
    const metadata = getStoredComponentMetadata(world.db);

    expect(metadata).toHaveLength(1);
    expect(metadata[0]!.defId).toBe('player1');
    expect(metadata[0]!.hash).toBe('jpl4yi');

    world.close();
  });

  test('should validate compatible components on world reload', async () => {
    const playerComponent = defineComponent({
      id: 'player2',
      schema: {
        name: s.string(),
        level: s.number()
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
  });

  test.skip('should reject incompatible components on world reload', async () => {
    const originalComponent = defineComponent({
      id: 'player3',
      schema: {
        name: s.string(),
        level: s.number()
      }
    });

    // Create initial world
    const world1 = await createWorld([originalComponent], {
      path: testDbPath
    });
    world1.close();

    const modifiedComponent = defineComponent({
      id: 'player3',
      schema: {
        name: s.string(),
        level: s.number(),
        experience: s.number()
      }
    });

    // TODO introduce options which freeze component defs
    await expect(loadWorld([modifiedComponent], testDbPath)).rejects.toThrow(
      /Component definition compatibility check failed/
    );
  });

  test('should handle component additions and removals', async () => {
    const playerComponent = defineComponent({
      id: 'player5',
      schema: {
        name: s.string(),
        level: s.number()
      }
    });

    const inventoryComponent = defineComponent({
      id: 'inventory1',
      schema: {
        capacity: s.number(),
        items: s.array('string').default([])
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
  });
});
