import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  addComponent,
  addComponents,
  defineComponent,
  removeComponent
} from '../component';
import { DatabaseType } from '../db';
import { createEntity } from '../entity';
import { createWorld, flush } from '../world';

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

const createTestWorld = async () => await createWorld({ dbType });

describe('component', () => {
  describe('addComponent', () => {
    test('should add a component to an entity', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should cache component data in entityCache', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'statsTest', { health: 100, level: 1, mana: 50 });

      // Clear initial dirty state
      flush(world);
      expect(world.dirtyEntities.has(entity.id)).toBe(false);

      // Modify component - should mark as dirty again
      (entity as any).statsTest.health = 90;

      expect((entity as any).statsTest.health).toBe(90);
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
    });

    test('should add multiple components to same entity', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();
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
      expect(entityWithBoth.statsTest.health).toBe(100);
      expect(entityWithBoth.locationTest.name).toBe('Forest');

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should persist component after flush', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();
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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();

      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      }) as any;
      flush(world);

      // Add another component to existing entity
      addComponent(entity, 'locationTest', {
        name: 'Forest',
        region: 'North'
      });

      expect(entity.statsTest.health).toBe(100);
      expect(entity.locationTest.name).toBe('Forest');
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should add multiple components to same entity with different names', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();
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
  });

  describe('removeComponent', () => {
    test('should remove a component from an entity', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      removeComponent(entity, 'statsTest');

      expect(entity.statsTest).toBeUndefined();
    });

    test('should remove component from database', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
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
      // Verify component is removed from database
      expect(e2).toHaveLength(0);
    });

    test('should remove component from entityCache', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Verify component is in cache
      expect(world.entityCache.get(entity.id)!.statsTest).toBeDefined();

      removeComponent(entity, 'statsTest');

      // Verify component is removed from cache
      expect(world.entityCache.get(entity.id)!.statsTest).toBeUndefined();
    });

    test('should remove component from dirtyEntities tracking', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(true);

      removeComponent(entity, 'statsTest');

      // Verify component is removed from dirty tracking (entire entry is deleted when empty)
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should clean up dirtyEntities entry when no components remain', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'statsTest');

      // Verify entire dirty entry is removed when no components remain
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should remove one component while keeping others', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();

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
      expect(world.dirtyEntities.get(entity.id)?.has('statsTest')).toBe(false);
      expect(world.dirtyEntities.get(entity.id)?.has('locationTest')).toBe(
        true
      );
    });

    test('should throw error for non-existent component definition', async () => {
      const world = (await createTestWorld()).build();
      const entity = createEntity(world);

      expect(() => {
        removeComponent(entity, 'nonexistent' as any);
      }).toThrow('Component def not found for nonexistent');
    });

    test('should handle removing component that was never added', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world) as any;

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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();

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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component (creates pending changes)
      entity.statsTest.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'statsTest');

      // Verify component is removed and dirty tracking is cleaned up
      expect(entity.statsTest).toBeUndefined();
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should work with complex component data', async () => {
      const world = (await createTestWorld())
        .registerComponent(inventoryComponent)
        .build();
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

      // Verify database cleanup
      const stmt = world.db.prepare(
        'SELECT * FROM tbl_inventory_test WHERE eid = ?'
      );
      expect(stmt.get(entity.id)).toBeNull();

      // Verify entity still exists
      const estmt = world.db.prepare('SELECT * FROM tbl_entity WHERE id = ?');
      expect(estmt.get(entity.id)).toBeDefined();

      // Verify entity is not dirty
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should handle removing component from entity with multiple components', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();

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
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();

      const entity = createEntity(world, {
        inventoryTest: { capacity: 10, items: '["sword"]' },
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity, 'locationTest', 'statsTest', 'inventoryTest');

      expect(entity.statsTest).toBeUndefined();
      expect(entity.locationTest).toBeUndefined();
      expect(entity.inventoryTest).toBeUndefined();
    });

    test('should handle removing all components at once', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();

      const entity = createEntity(world, {
        inventoryTest: { capacity: 10, items: '["sword"]' },
        locationTest: { name: 'Forest', region: 'North' },
        statsTest: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity);

      expect(entity.statsTest).toBeUndefined();
      expect(entity.locationTest).toBeUndefined();
      expect(entity.inventoryTest).toBeUndefined();
    });
  });
});
