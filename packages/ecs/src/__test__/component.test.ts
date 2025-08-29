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
  name: 'stats_test' as const,
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  }
});

const locationComponent = defineComponent({
  name: 'location_test' as const,
  schema: {
    name: z.string(),
    region: z.string()
  }
});

const inventoryComponent = defineComponent({
  name: 'inventory_test' as const,
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

      const entityWithStats = addComponent(entity, 'stats_test', {
        health: 100,
        level: 1,
        mana: 50
      });

      expect(entityWithStats.stats_test).toBeDefined();
      expect(entityWithStats.stats_test.health).toBe(100);
      expect(entityWithStats.stats_test.level).toBe(1);
      expect(entityWithStats.stats_test.mana).toBe(50);
    });

    test('should mark entity as dirty when adding component', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'stats_test', { health: 100, level: 1, mana: 50 });

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(true);
    });

    test('should cache component data in entityCache', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'stats_test', { health: 100, level: 1, mana: 50 });

      const cache = world.entityCache.get(entity.id);
      expect(cache).toBeDefined();
      expect(cache!.stats_test).toBeDefined();
      expect(cache!.stats_test!.data.health).toBe(100);
      expect(cache!.stats_test!.data.level).toBe(1);
      expect(cache!.stats_test!.data.mana).toBe(50);
      expect(cache!.stats_test!.exists).toBe(false); // New component, not yet persisted
    });

    test('should create tracked component with proxy', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'stats_test', { health: 100, level: 1, mana: 50 });

      // Clear initial dirty state
      flush(world);
      expect(world.dirtyEntities.has(entity.id)).toBe(false);

      // Modify component - should mark as dirty again
      (entity as any).stats_test.health = 90;

      expect((entity as any).stats_test.health).toBe(90);
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(true);
    });

    test('should add multiple components to same entity', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'stats_test', {
        health: 100,
        level: 1,
        mana: 50
      });
      const entityWithBoth = addComponent(entityWithStats, 'location_test', {
        name: 'Forest',
        region: 'North'
      });

      expect(entityWithBoth.stats_test).toBeDefined();
      expect(entityWithBoth.location_test).toBeDefined();
      expect(entityWithBoth.stats_test.health).toBe(100);
      expect(entityWithBoth.location_test.name).toBe('Forest');

      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('location_test')).toBe(
        true
      );
    });

    test('should persist component after flush', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      addComponent(entity, 'stats_test', { health: 100, level: 1, mana: 50 });

      // Before flush - component exists but not persisted
      const cacheBefore = world.entityCache.get(entity.id)!.stats_test!;
      expect(cacheBefore.exists).toBe(false);

      // Flush to persist
      flush(world);

      // After flush - should be marked as existing in database
      const cacheAfter = world.entityCache.get(entity.id)!.stats_test!;
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

      const entityWithStats = addComponent(entity, 'stats_test', {
        health: 100,
        level: 1,
        mana: 50
      });
      const entityWithLocation = addComponent(
        entityWithStats,
        'location_test',
        { name: 'City', region: 'Central' }
      );
      const entityWithInventory = addComponent(
        entityWithLocation,
        'inventory_test',
        { capacity: 10, items: '["sword", "potion"]' }
      );

      expect(entityWithStats.stats_test.health).toBe(100);
      expect(entityWithLocation.location_test.name).toBe('City');
      expect(entityWithInventory.inventory_test.capacity).toBe(10);
      expect(entityWithInventory.inventory_test.items).toBe(
        '["sword", "potion"]'
      );
    });

    test('should handle component modifications after adding', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world);

      const entityWithStats = addComponent(entity, 'stats_test', {
        health: 100,
        level: 1,
        mana: 50
      });
      flush(world);

      // Modify component
      entityWithStats.stats_test.health = 90;
      entityWithStats.stats_test.level = 2;
      entityWithStats.stats_test.mana = 40;

      expect(entityWithStats.stats_test.health).toBe(90);
      expect(entityWithStats.stats_test.level).toBe(2);
      expect(entityWithStats.stats_test.mana).toBe(40);
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(true);
    });

    test('should work with entity that already has components', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();

      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      }) as any;
      flush(world);

      // Add another component to existing entity
      addComponent(entity, 'location_test', {
        name: 'Forest',
        region: 'North'
      });

      expect(entity.stats_test.health).toBe(100);
      expect(entity.location_test.name).toBe('Forest');
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('location_test')).toBe(
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
        location_test: { name: 'Forest', region: 'North' },
        stats_test: { health: 100, level: 1, mana: 50 }
      });

      expect(entityWithComponents.stats_test).toBeDefined();
      expect(entityWithComponents.location_test).toBeDefined();
      expect(entityWithComponents.stats_test.health).toBe(100);
      expect(entityWithComponents.location_test.name).toBe('Forest');
    });
  });

  describe('removeComponent', () => {
    test('should remove a component from an entity', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      removeComponent(entity, 'stats_test');

      expect(entity.stats_test).toBeUndefined();
    });

    test('should remove component from database', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Verify component exists in database
      const e = world.db.query(
        'SELECT * FROM tbl_stats_test WHERE eid = ?',
        entity.id
      );
      expect(e).toBeDefined();

      removeComponent(entity, 'stats_test');

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
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Verify component is in cache
      expect(world.entityCache.get(entity.id)!.stats_test).toBeDefined();

      removeComponent(entity, 'stats_test');

      // Verify component is removed from cache
      expect(world.entityCache.get(entity.id)!.stats_test).toBeUndefined();
    });

    test('should remove component from dirtyEntities tracking', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.stats_test.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(true);

      removeComponent(entity, 'stats_test');

      // Verify component is removed from dirty tracking (entire entry is deleted when empty)
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should clean up dirtyEntities entry when no components remain', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component to mark as dirty
      entity.stats_test.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'stats_test');

      // Verify entire dirty entry is removed when no components remain
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should remove one component while keeping others', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .build();

      const entity = createEntity(world, {
        location_test: { name: 'Forest', region: 'North' },
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify both components
      entity.stats_test.health = 90;
      entity.location_test.name = 'Mountain';

      removeComponent(entity, 'stats_test');

      // Verify stats is removed but location remains
      expect(entity.stats_test).toBeUndefined();
      expect(entity.location_test.name).toBe('Mountain');
      expect(world.dirtyEntities.has(entity.id)).toBe(true);
      expect(world.dirtyEntities.get(entity.id)?.has('stats_test')).toBe(false);
      expect(world.dirtyEntities.get(entity.id)?.has('location_test')).toBe(
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
      expect(entity.stats_test).toBeUndefined();

      // Should not throw when removing non-existent component
      expect(() => {
        removeComponent(entity, 'stats_test');
      }).not.toThrow();

      // Should still be undefined
      expect(entity.stats_test).toBeUndefined();
    });

    test('should work with multiple entities independently', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();

      const entity1 = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      const entity2 = createEntity(world, {
        stats_test: { health: 80, level: 2, mana: 40 }
      });
      flush(world);

      // Remove component from one entity
      removeComponent(entity1, 'stats_test');

      // Verify first entity has no stats
      expect(entity1.stats_test).toBeUndefined();

      // Verify second entity still has stats
      expect(entity2.stats_test).toBeDefined();
      expect(entity2.stats_test.health).toBe(80);
    });

    test('should handle removing component with pending changes', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .build();
      const entity = createEntity(world, {
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Modify component (creates pending changes)
      entity.stats_test.health = 90;
      expect(world.dirtyEntities.has(entity.id)).toBe(true);

      removeComponent(entity, 'stats_test');

      // Verify component is removed and dirty tracking is cleaned up
      expect(entity.stats_test).toBeUndefined();
      expect(world.dirtyEntities.has(entity.id)).toBe(false);
    });

    test('should work with complex component data', async () => {
      const world = (await createTestWorld())
        .registerComponent(inventoryComponent)
        .build();
      const entity = createEntity(world, {
        inventory_test: {
          capacity: 20,
          items: '["sword", "shield", "potion", "key"]'
        }
      });
      flush(world);

      // Verify component exists
      expect(entity.inventory_test.capacity).toBe(20);
      expect(entity.inventory_test.items).toBe(
        '["sword", "shield", "potion", "key"]'
      );

      removeComponent(entity, 'inventory_test');

      // Verify component is removed
      expect(entity.inventory_test).toBeUndefined();

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
        inventory_test: { capacity: 10, items: '["sword"]' },
        location_test: { name: 'Forest', region: 'North' },
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity, 'location_test');

      // Verify location is removed but others remain
      expect(entity.stats_test).toBeDefined();
      expect(entity.location_test).toBeUndefined();
      expect(entity.inventory_test).toBeDefined();

      expect(entity.stats_test.health).toBe(100);
      expect(entity.inventory_test.capacity).toBe(10);
    });

    test('should handle removing several named components at once', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();

      const entity = createEntity(world, {
        inventory_test: { capacity: 10, items: '["sword"]' },
        location_test: { name: 'Forest', region: 'North' },
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity, 'location_test', 'stats_test', 'inventory_test');

      expect(entity.stats_test).toBeUndefined();
      expect(entity.location_test).toBeUndefined();
      expect(entity.inventory_test).toBeUndefined();
    });

    test('should handle removing all components at once', async () => {
      const world = (await createTestWorld())
        .registerComponent(statsComponent)
        .registerComponent(locationComponent)
        .registerComponent(inventoryComponent)
        .build();

      const entity = createEntity(world, {
        inventory_test: { capacity: 10, items: '["sword"]' },
        location_test: { name: 'Forest', region: 'North' },
        stats_test: { health: 100, level: 1, mana: 50 }
      });
      flush(world);

      // Remove middle component
      removeComponent(entity);

      expect(entity.stats_test).toBeUndefined();
      expect(entity.location_test).toBeUndefined();
      expect(entity.inventory_test).toBeUndefined();
    });
  });
});
