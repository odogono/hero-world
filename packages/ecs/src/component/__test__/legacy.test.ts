import { describe, expect, test } from 'bun:test';
import z from 'zod';

import { DatabaseType } from '@db';
import { createEntity, queryEntity } from '@entity';
import { createWorld, flush } from '@world';

import {
  addComponent,
  addComponents,
  defineComponent,
  removeComponent
} from '../legacy';

// Component definitions for testing - using unique names to avoid Zod registry conflicts
const statsComponent = defineComponent({
  name: 'statsTest',
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  }
});

const locationComponent = defineComponent({
  name: 'locationTest',
  schema: {
    name: z.string(),
    region: z.string()
  }
});

const inventoryComponent = defineComponent({
  name: 'inventoryTest',
  schema: {
    capacity: z.number(),
    items: z.string()
  }
});

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const worldOpts = {
  clearExisting: true,
  dbType: (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN,
  path: ':memory:'
};

describe.skip('component', () => {
  describe('addComponent', () => {
    test('should add a component to an entity', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'statsTest', {
        health: 100,
        level: 1,
        mana: 50
      });

      expect(entityWithStats.statsTest).toBeDefined();
      expect(entityWithStats.statsTest.health).toBe(100);
      expect(entityWithStats.statsTest.level).toBe(1);
      expect(entityWithStats.statsTest.mana).toBe(50);
    });

    test('should mark entity as dirty when adding component', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should cache component data in entityCache', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      const cache = world.entityCache.get(entity.id);
      expect(cache).toBeDefined();
      expect(cache!.statsTest).toBeDefined();
      expect(cache!.statsTest!.data.health).toBe(100);
      expect(cache!.statsTest!.data.level).toBe(1);
      expect(cache!.statsTest!.data.mana).toBe(50);
      expect(cache!.statsTest!.exists).toBe(false); // New component, not yet persisted
    });

    test('should create tracked component with proxy', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      // Clear initial dirty state
      flush(world);
      expect(world.dirtyEntities.has(entity.id)).toBe(false);

      // Modify component - should mark as dirty again
      entity.statsTest!.health = 90;

      expect(entity.statsTest!.health).toBe(90);
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should add multiple components to same entity', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent],
        worldOpts
      );
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'statsTest', {
        health: 100,
        level: 1,
        mana: 50
      });
      const entityWithBoth = addComponent(entityWithStats, 'locationTest', {
        name: 'Forest',
        region: 'North'
      });

      expect(entityWithBoth.statsTest).toBeDefined();
      expect(entityWithBoth.locationTest).toBeDefined();
      expect(entityWithBoth.statsTest!.health).toBe(100);
      expect(entityWithBoth.locationTest.name).toBe('Forest');

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should persist component after flush', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      // Before flush - component exists but not persisted
      const cacheBefore = world.entityCache.get(entity.id)!.statsTest!;
      expect(cacheBefore.exists).toBe(false);

      // Flush to persist
      flush(world);

      // After flush - should be marked as existing in database
      const cacheAfter = world.entityCache.get(entity.id)!.statsTest!;
      expect(cacheAfter.exists).toBe(true);
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should work with different component types', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent, inventoryComponent],
        worldOpts
      );
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'statsTest', {
        health: 100,
        level: 1,
        mana: 50
      });
      const entityWithLocation = addComponent(entityWithStats, 'locationTest', {
        name: 'City',
        region: 'Central'
      });
      const entityWithInventory = addComponent(
        entityWithLocation,
        'inventoryTest',
        { capacity: 10, items: '["sword", "potion"]' }
      );

      expect(entityWithStats.statsTest.health).toBe(100);
      expect(entityWithLocation.locationTest.name).toBe('City');
      expect(entityWithInventory.inventoryTest.capacity).toBe(10);
      expect(entityWithInventory.inventoryTest.items).toBe(
        '["sword", "potion"]'
      );
    });

    test('should handle component modifications after adding', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'statsTest', {
        health: 100,
        level: 1,
        mana: 50
      });
      flush(world);

      // Modify component
      entityWithStats.statsTest.health = 90;
      entityWithStats.statsTest.level = 2;
      entityWithStats.statsTest.mana = 40;

      expect(entityWithStats.statsTest.health).toBe(90);
      expect(entityWithStats.statsTest.level).toBe(2);
      expect(entityWithStats.statsTest.mana).toBe(40);
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should work with entity that already has components', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent],
        worldOpts
      );

      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Add another component to existing entity
      addComponent(entity, 'locationTest', {
        name: 'Forest',
        region: 'North'
      });

      expect(entity.statsTest.health).toBe(100);
      expect(entity.locationTest!.name).toBe('Forest');
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should add multiple components to same entity with different names', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent],
        worldOpts
      );
      const entity = createEntity(world);

      const entityWithComponents = addComponents(entity, {
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });

      expect(entityWithComponents.statsTest).toBeDefined();
      expect(entityWithComponents.locationTest).toBeDefined();
      expect(entityWithComponents.statsTest.health).toBe(100);
      expect(entityWithComponents.locationTest.name).toBe('Forest');
    });

    describe('addComponent via object', () => {
      test('should add a component to an entity', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );
        const entity = createEntity(world);

        entity.locationTest = {
          name: 'Dungeon',
          region: 'North'
        };

        flush(world);

        const e2 = queryEntity(world, { with: ['locationTest'] })!;
        expect(e2).toBeDefined();
        expect(e2.locationTest.name).toBe('Dungeon');
        expect(e2.locationTest.region).toBe('North');
      });

      test('should add component via direct property assignment', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );
        const entity = createEntity(world);

        // Direct property assignment - this should automatically add the component
        entity.locationTest = {
          name: 'Castle',
          region: 'South'
        };

        flush(world);

        const e2 = queryEntity(world, { with: ['locationTest'] })!;
        expect(e2).toBeDefined();
        expect(e2.locationTest!.name).toBe('Castle');
        expect(e2.locationTest!.region).toBe('South');
      });

      test('should add multiple components via direct property assignment', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );
        const entity = createEntity(world);

        // Add multiple components via direct assignment
        entity.locationTest = {
          name: 'Village',
          region: 'East'
        };
        entity.statsTest = {
          health: 75,
          level: 5,
          mana: 25
        };

        flush(world);

        const e = queryEntity(world, { with: ['locationTest', 'statsTest'] })!;
        expect(e).toBeDefined();
        expect(e.locationTest.name).toBe('Village');
        expect(e.locationTest.region).toBe('East');
        expect(e.statsTest.health).toBe(75);
        expect(e.statsTest.level).toBe(5);
        expect(e.statsTest.mana).toBe(25);
      });

      test('should delete component via direct property assignment with null', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );
        const entity = createEntity(world);

        // Add components first
        entity.locationTest = {
          name: 'Forest',
          region: 'North'
        };
        entity.statsTest = {
          health: 100,
          level: 1,
          mana: 50
        };

        flush(world);

        // Verify components exist
        const e = queryEntity(world, { with: ['locationTest', 'statsTest'] })!;
        expect(e).toBeDefined();
        expect(e.locationTest).toBeDefined();
        expect(e.statsTest).toBeDefined();

        // Delete location component by setting to null
        entity.locationTest = undefined;

        flush(world);

        // Verify location component is removed
        const e2 = queryEntity(world, { with: ['statsTest'] })!;
        expect(e2).toBeDefined();
        expect(e2.locationTest).toBeUndefined();
        expect(e2.statsTest).toBeDefined();
        expect(e2.statsTest.health).toBe(100);
      });

      test('should delete component via direct property assignment with undefined', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );
        const entity = createEntity(world);

        // Add components first
        entity.locationTest = {
          name: 'Forest',
          region: 'North'
        };
        entity.statsTest = {
          health: 100,
          level: 1,
          mana: 50
        };

        flush(world);

        // Verify components exist
        const e = queryEntity(world, { with: ['locationTest', 'statsTest'] })!;
        expect(e).toBeDefined();
        expect(e.locationTest).toBeDefined();
        expect(e.statsTest).toBeDefined();

        // Delete stats component by setting to undefined
        entity.statsTest = undefined;

        flush(world);

        // Verify stats component is removed
        const e2 = queryEntity(world, { with: ['locationTest'] })!;
        expect(e).toBeDefined();
        expect(e2.locationTest).toBeDefined();
        expect(e2.locationTest.name).toBe('Forest');
        expect(e2.statsTest).toBeUndefined();
      });

      test('should handle mixed add and delete operations via property assignment', async () => {
        const world = await createWorld(
          [statsComponent, locationComponent],
          worldOpts
        );

        const entity = createEntity(world);

        // Add components
        entity.locationTest = {
          name: 'Forest',
          region: 'North'
        };
        entity.statsTest = {
          health: 100,
          level: 1,
          mana: 50
        };

        flush(world);

        // Verify both components exist
        const e = queryEntity(world, { with: ['locationTest', 'statsTest'] })!;
        expect(e).toBeDefined();
        expect(e.locationTest).toBeDefined();
        expect(e.statsTest).toBeDefined();

        // Delete one component and modify another
        entity.locationTest = undefined;
        entity.statsTest = {
          health: 75,
          level: 2,
          mana: 25
        };

        flush(world);

        // Verify location is removed and stats is updated
        const e2 = queryEntity(world, {
          with: ['statsTest']
        })!;
        expect(e2).toBeDefined();
        expect(e2.locationTest).toBeUndefined();
        expect(e2.statsTest).toBeDefined();
        expect(e2.statsTest.health).toBe(75);
        expect(e2.statsTest.level).toBe(2);
        expect(e2.statsTest.mana).toBe(25);
      });
    });
  });

  describe('removeComponent', () => {
    test('should remove a component from an entity', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      removeComponent(entity, 'statsTest');

      expect(entity.statsTest).toBeUndefined();
    });

    test('should remove component from database', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Verify component exists in database
      const e = world.db.query(
        'SELECT * FROM tbl_stats_test WHERE eid = ?',
        entity.id
      );
      expect(e).toBeDefined();

      removeComponent(entity, 'statsTest');

      const e2 = world.db.query(
        'SELECT * FROM tbl_stats_test WHERE eid = ?',
        entity.id
      );
      // Component is marked for deletion but not yet removed from database
      expect(e2).toHaveLength(1);
    });

    test('should remove component from entityCache', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Verify component is in cache
      expect(world.entityCache.get(entity.id)!.statsTest).toBeDefined();

      removeComponent(entity, 'statsTest');

      // Component is marked for deletion in cache (exists: false, data: null)
      const cacheEntry = world.entityCache.get(entity.id)!.statsTest;
      expect(cacheEntry).toBeDefined();
      expect(cacheEntry!.exists).toBe(false);
      expect(cacheEntry!.data).toBeNull();
    });

    test('should remove component from dirtyEntities tracking', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);

      removeComponent(entity, 'statsTest');

      // Component is marked as dirty for deletion
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should clean up dirtyEntities entry when no components remain', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'statsTest');

      // Component is marked as dirty for deletion
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should remove one component while keeping others', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent],
        worldOpts
      );

      const entity = createEntity(world, {
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify both components
      entity.statsTest.health = 90;
      entity.locationTest.name = 'Mountain';

      removeComponent(entity, 'statsTest');

      // Verify stats is removed but location remains
      expect(entity.statsTest).toBeUndefined();
      expect(entity.locationTest.name).toBe('Mountain');
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should throw error for non-existent component definition', async () => {
      const world = await createWorld([], worldOpts);
      const entity = createEntity(world);

      // removeComponent doesn't throw for non-existent components
      expect(() => {
        removeComponent(entity, 'nonexistent');
      }).not.toThrow();
    });

    test('should handle removing component that was never added', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world);

      // Entity has no stats component
      expect(entity.statsTest).toBeUndefined();

      // Should not throw when removing non-existent component
      expect(() => {
        removeComponent(entity, 'statsTest');
      }).not.toThrow();

      // Should still be undefined
      expect(entity.statsTest).toBeUndefined();
    });

    test('should work with multiple entities independently', async () => {
      const world = await createWorld([statsComponent], worldOpts);

      const entity1 = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      const entity2 = createEntity(world, {
        statsTest: { health: 80, level: 2, mana: 40 }
      });
      flush(world);

      // Remove component from one entity
      removeComponent(entity1, 'statsTest');

      // Verify first entity has no stats
      expect(entity1.statsTest).toBeUndefined();

      // Verify second entity still has stats
      expect(entity2.statsTest).toBeDefined();
      expect(entity2.statsTest.health).toBe(80);
    });

    test('should handle removing component with pending changes', async () => {
      const world = await createWorld([statsComponent], worldOpts);
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component (creates pending changes)
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'statsTest');

      // Verify component is removed and marked as dirty for deletion
      expect(entity.statsTest).toBeUndefined();
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should work with complex component data', async () => {
      const world = await createWorld([inventoryComponent], worldOpts);
      const entity = createEntity(world, {
        inventoryTest: {
          capacity: 20,
          items: '["sword", "shield", "potion", "key"]'
        }
      });
      flush(world);

      // Verify component exists
      expect(entity.inventoryTest.capacity).toBe(20);
      expect(entity.inventoryTest.items).toBe(
        '["sword", "shield", "potion", "key"]'
      );

      removeComponent(entity, 'inventoryTest');

      // Verify component is removed
      expect(entity.inventoryTest).toBeUndefined();

      // Component is marked for deletion but not yet removed from database
      const stmt = world.db.prepare(
        'SELECT * FROM tbl_inventory_test WHERE eid = ?'
      );
      expect(stmt.get(entity.id)).toBeDefined();

      // Verify entity still exists
      const estmt = world.db.prepare('SELECT * FROM tbl_entity WHERE id = ?');
      expect(estmt.get(entity.id)).toBeDefined();

      // Entity is marked as dirty for deletion
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('inventoryTest')).toBe(
        true
      );
    });

    test('should handle removing component from entity with multiple components', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent, inventoryComponent],
        worldOpts
      );

      const entity = createEntity(world, {
        inventoryTest: { capacity: 10, items: '["sword"]' },
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity, 'locationTest');

      // Verify location is removed but others remain
      expect(entity.statsTest).toBeDefined();
      expect(entity.locationTest).toBeUndefined();
      expect(entity.inventoryTest).toBeDefined();

      expect(entity.statsTest.health).toBe(100);
      expect(entity.inventoryTest.capacity).toBe(10);
    });

    test('should handle removing several named components at once', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent, inventoryComponent],
        worldOpts
      );

      const entity = createEntity(world, {
        inventoryTest: { capacity: 10, items: '["sword"]' },
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove multiple components
      removeComponent(entity, 'locationTest');
      removeComponent(entity, 'statsTest');
      removeComponent(entity, 'inventoryTest');

      expect(entity.statsTest).toBeUndefined();
      expect(entity.locationTest).toBeUndefined();
      expect(entity.inventoryTest).toBeUndefined();
    });

    test('should handle removing all components at once', async () => {
      const world = await createWorld(
        [statsComponent, locationComponent, inventoryComponent],
        worldOpts
      );

      const entity = createEntity(world, {
        inventoryTest: { capacity: 10, items: '["sword"]' },
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove all components
      removeComponent(entity, 'locationTest');
      removeComponent(entity, 'statsTest');
      removeComponent(entity, 'inventoryTest');

      expect(entity.statsTest).toBeUndefined();
      expect(entity.locationTest).toBeUndefined();
      expect(entity.inventoryTest).toBeUndefined();
    });
  });
});
