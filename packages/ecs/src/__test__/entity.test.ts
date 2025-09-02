import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test';
import { createLog } from 'odgn-helpers/log';
import z from 'zod';

import { defineComponent } from '../component';
import { DatabaseType } from '../db';
import { createEntity, deleteEntity, getEntity } from '../entity';
import type { WorldBuilderGeneric } from '../types';
import { createWorld, flush } from '../world';

const log = createLog('test-entity');

// NOTE currently breaks earlier registration of entity schema
// z.globalRegistry.clear();

// Component definitions using new system
const statsComponent = defineComponent({
  name: 'teStats',
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  },
  statements: {
    statsByLevel: 'SELECT * FROM tbl_te_stats WHERE level = ?'
  }
});

const inventoryComponent = defineComponent({
  name: 'teInventory',
  schema: {
    capacity: z.number(),
    items: z.string() // JSON string for simplicity
  },
  statements: {
    inventoryByCapacity: 'SELECT * FROM tbl_te_inventory WHERE capacity = ?'
  }
});

const locationComponent = defineComponent({
  name: 'teLocation',
  schema: {
    name: z.string(),
    region: z.string()
  },
  statements: {
    locationSelectByName: 'SELECT eid as id FROM tbl_te_location WHERE name = ?'
  },
  tableName: 'tbl_te_location'
});

const createTestWorld = async () => {
  const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;
  // return await createWorld({ dbType });
  return await createWorld({ clearExisting: true, dbType, path: ':memory:' });
};

describe('createEntity', () => {
  let builder: WorldBuilderGeneric<any>;

  beforeEach(async () => {
    builder = await createTestWorld();
  });

  afterEach(() => {
    builder.close();
  });

  test('create entity with components', async () => {
    const stats = defineComponent({
      name: 'specialStats',
      schema: {
        agility: z.number(),
        strength: z.number()
      }
    });

    const world = builder.registerComponent(stats).build();

    const entity = createEntity(world, {
      specialStats: {
        agility: 10,
        strength: 20
      }
    });

    expect(entity.specialStats.strength).toBe(20);
  });

  test('createEntity should create entity without components', async () => {
    const world = builder.build();

    const entity = createEntity(world);

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.id).toBeGreaterThan(0);
    expect(entity.world).toBe(world);

    // await world.db.saveToPath('world.db');
  });

  test('createEntity should create multiple entities with unique IDs', async () => {
    const world = builder.build();

    const entity1 = createEntity(world);
    const entity2 = createEntity(world);
    const entity3 = createEntity(world);

    expect(entity1.id).not.toBe(entity2.id);
    expect(entity2.id).not.toBe(entity3.id);
    expect(entity1.id).not.toBe(entity3.id);

    expect(entity1.id).toBeLessThan(entity2.id);
    expect(entity2.id).toBeLessThan(entity3.id);
  });

  test('createEntity should create entity with location component', async () => {
    const world = builder.registerComponent(locationComponent).build();

    const entity = createEntity(world, {
      teLocation: { name: 'Forest', region: 'North' }
    });

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.teLocation).toBeDefined();
    expect(entity.teLocation.name).toBe('Forest');
    expect(entity.teLocation.region).toBe('North');
  });

  test('createEntity should create entity with stats component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 5, mana: 50 }
    });

    expect(entity).toBeDefined();
    expect(entity.teStats).toBeDefined();
    expect(entity.teStats.health).toBe(100);
    expect(entity.teStats.mana).toBe(50);
    expect(entity.teStats.level).toBe(5);
  });

  test('createEntity should create entity with inventory component', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const items = JSON.stringify(['sword', 'potion', 'key']);
    const entity = createEntity(world, {
      teInventory: { capacity: 10, items }
    });

    expect(entity).toBeDefined();
    expect(entity.teInventory).toBeDefined();
    expect(entity.teInventory.capacity).toBe(10);
    expect(entity.teInventory.items).toBe(items);
  });

  test('createEntity should create entity with multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      teLocation: { name: 'City', region: 'Central' },
      teStats: { health: 80, level: 3, mana: 30 }
    });

    expect(entity.teLocation).toBeDefined();
    expect(entity.teLocation.name).toBe('City');
    expect(entity.teLocation.region).toBe('Central');

    expect(entity.teStats).toBeDefined();
    expect(entity.teStats.health).toBe(80);
    expect(entity.teStats.mana).toBe(30);
    expect(entity.teStats.level).toBe(3);
  });

  test('createEntity should track component changes', async () => {
    const world = builder.registerComponent(locationComponent).build();

    const entity = createEntity(world, {
      teLocation: { name: 'Forest', region: 'North' }
    });

    // Initial state - entity should be marked as dirty
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teLocation')).toBe(true);

    // Clear dirty state by flushing
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify component - should mark as dirty again
    entity.teLocation.name = 'Mountain';

    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teLocation')).toBe(true);
    expect(entity.teLocation.name).toBe('Mountain');
  });

  test('createEntity should track changes across multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      teLocation: { name: 'Village', region: 'East' },
      teStats: { health: 100, level: 1, mana: 50 }
    });

    // Clear dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify location component
    entity.teLocation.name = 'Town';
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teLocation')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teStats')).toBe(false);

    // Modify stats component
    entity.teStats.level = 2;
    expect(world.dirtyEntities.get(entity.id)?.has('teLocation')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teStats')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.size).toBe(2);
  });

  test('createEntity should cache components in entityCache', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 75, level: 4, mana: 25 }
    });

    expect(world.entityCache.has(entity.id)).toBe(true);

    const cached = world.entityCache.get(entity.id);
    expect(cached).toBeDefined();
    expect(cached!.teStats).toBeDefined();
    expect(cached!.teStats!.data).toBeDefined();
    expect(cached!.teStats!.data!.health).toBe(75);
    expect(cached!.teStats!.data!.mana).toBe(25);
    expect(cached!.teStats!.data!.level).toBe(4);
    expect(cached!.teStats!.exists).toBe(false); // New component, not yet persisted
  });

  test('createEntity should persist components after flush', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const entity = createEntity(world, {
      teInventory: { capacity: 5, items: '["apple", "bread"]' }
    });

    // Before flush - component exists but not persisted
    const cacheBefore = world.entityCache.get(entity.id)!.teInventory!;
    expect(cacheBefore.exists).toBe(false);

    // Flush to persist
    flush(world);

    // await world.db.saveToPath('world.db');

    // After flush - should be marked as existing in database
    const cacheAfter = world.entityCache.get(entity.id)!.teInventory!;
    expect(cacheAfter.exists).toBe(true);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
  });

  test('createEntity should work with component modifications through proxy', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 10, mana: 100 }
    });

    // Clear dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify multiple properties
    entity.teStats.health = 90;
    entity.teStats.mana = 80;
    entity.teStats.level = 11;

    expect(entity.teStats.health).toBe(90);
    expect(entity.teStats.mana).toBe(80);
    expect(entity.teStats.level).toBe(11);
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teStats')).toBe(true);
  });

  test('createEntity should handle different component data types', async () => {
    // Test with string component

    const nameComponent = defineComponent({
      name: 'testName',
      schema: {
        firstName: z.string(),
        lastName: z.string(),
        title: z.string().optional()
      }
    });

    const world = builder.registerComponent(nameComponent).build();

    const entity = createEntity(world, {
      testName: { firstName: 'John', lastName: 'Doe', title: 'Sir' }
    });

    expect(entity.testName).toBeDefined();
    expect(entity.testName.firstName).toBe('John');
    expect(entity.testName.lastName).toBe('Doe');
    expect(entity.testName.title).toBe('Sir');

    // Test modifications
    flush(world);
    entity.testName.title = 'Lord';
    expect(entity.testName.title).toBe('Lord');
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
  });

  test('should create world with builder pattern and single component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    expect(world).toBeDefined();
    expect(world.defs.has('teStats')).toBe(true);
  });

  test('should create world with multiple components using builder pattern', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .registerComponent(inventoryComponent)
      .build();

    expect(world.defs.has('teLocation')).toBe(true);
    expect(world.defs.has('teStats')).toBe(true);
    expect(world.defs.has('teInventory')).toBe(true);
  });

  test('should create typed entity with single component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.teStats).toBeDefined();
    expect(entity.teStats.health).toBe(100);
    expect(entity.teStats.mana).toBe(50);
    expect(entity.teStats.level).toBe(1);
  });

  test('should create typed entity with multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      teLocation: { name: 'Forest', region: 'North' },
      teStats: { health: 80, level: 3, mana: 30 }
    });

    expect(entity.teLocation.name).toBe('Forest');
    expect(entity.teLocation.region).toBe('North');
    expect(entity.teStats.health).toBe(80);
    expect(entity.teStats.mana).toBe(30);
    expect(entity.teStats.level).toBe(3);
  });

  test('should create typed entity without initial components', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world);

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.world).toBe(world);
  });

  test('should track component changes in typed entities', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });

    // Clear initial dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify component
    entity.teStats.health = 90;
    entity.teStats.level = 2;

    expect(entity.teStats.health).toBe(90);
    expect(entity.teStats.level).toBe(2);
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('teStats')).toBe(true);
  });

  test('should persist typed entity components after flush', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const entity = createEntity(world, {
      teInventory: { capacity: 10, items: '["sword", "shield"]' }
    });

    // Before flush
    const cacheBefore = world.entityCache.get(entity.id)!.teInventory!;
    expect(cacheBefore.exists).toBe(false);

    // Flush and check
    flush(world);

    const cacheAfter = world.entityCache.get(entity.id)!.teInventory!;
    expect(cacheAfter.exists).toBe(true);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
  });

  it('should work with custom component statements', async () => {
    const world = builder.registerComponent(statsComponent).build();

    createEntity(world, {
      teStats: { health: 75, level: 5, mana: 25 }
    });

    flush(world);

    // Test custom statement from component definition
    const def = world.defs.get('teStats');
    expect(def).toBeDefined();
    expect(def!.statsByLevel).toBeDefined();

    // Execute custom statement
    const results = def!.statsByLevel!.all([5]);

    // console.log(results);

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  test('should handle complex multi-component scenarios', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .registerComponent(inventoryComponent)
      .build();

    // Create multiple entities
    const warrior = createEntity(world, {
      teInventory: { capacity: 15, items: '["sword", "armor", "potion"]' },
      teLocation: { name: 'Battlefield', region: 'War Zone' },
      teStats: { health: 120, level: 8, mana: 10 }
    });

    const mage = createEntity(world, {
      teInventory: { capacity: 8, items: '["staff", "spellbook", "robe"]' },
      teLocation: { name: 'Tower', region: 'Magic District' },
      teStats: { health: 60, level: 10, mana: 200 }
    });

    flush(world);

    // Verify both entities exist and have correct data
    expect(warrior.teLocation.name).toBe('Battlefield');
    expect(warrior.teStats.health).toBe(120);
    expect(warrior.teInventory.capacity).toBe(15);

    expect(mage.teLocation.name).toBe('Tower');
    expect(mage.teStats.mana).toBe(200);
    expect(mage.teInventory.capacity).toBe(8);

    // Modify components
    warrior.teStats.health = 100;
    mage.teStats.mana = 180;

    expect(world.dirtyEntities.has(warrior.id)).toBe(true);
    expect(world.dirtyEntities.has(mage.id)).toBe(true);
  });
});

describe('deleteEntity', () => {
  let builder: WorldBuilderGeneric<any>;

  beforeEach(async () => {
    builder = await createTestWorld();
  });

  afterEach(() => {
    builder.close();
  });

  test('deleteEntity should remove entity from database', async () => {
    const world = builder.build();

    const entity = createEntity(world);

    // Verify entity exists
    const e = getEntity(world, entity.id);
    expect(e!.id).toEqual(entity.id);

    // Delete entity
    deleteEntity(entity);

    // Verify entity is marked for deletion but not yet removed from database
    const e2 = getEntity(world, entity.id);
    expect(e2).toBeDefined(); // Entity still exists until flush

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    const e3 = getEntity(world, entity.id);
    expect(e3).toBeNull();
  });

  test('deleteEntity should remove entity with components', async () => {
    const world = builder.registerComponent(locationComponent).build();

    const entity = createEntity(world, {
      teLocation: { name: 'Forest', region: 'North' }
    });
    flush(world);

    // Verify entity and component exist
    expect(getEntity(world, entity.id)).toBeDefined();
    expect(entity.teLocation.name).toBe('Forest');

    // Delete entity
    deleteEntity(entity);

    // Verify entity is marked for deletion but not yet removed from database
    expect(getEntity(world, entity.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should clean up entity cache', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });

    // Verify entity is in cache
    expect(world.entityCache.has(entity.id)).toBe(true);

    // Delete entity
    deleteEntity(entity);

    // Verify entity is removed from cache
    expect(world.entityCache.has(entity.id)).toBe(false);
  });

  test('deleteEntity should clean up dirty entities tracking', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });

    // Verify entity is marked as dirty
    expect(world.dirtyEntities.has(entity.id)).toBe(true);

    // Delete entity
    deleteEntity(entity);

    // Verify entity is removed from dirty tracking
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
  });

  test('deleteEntity should cascade delete components from database', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      teLocation: { name: 'Village', region: 'East' },
      teStats: { health: 80, level: 3, mana: 30 }
    });
    flush(world);

    // Verify components exist in database
    const locationStmt = world.db.prepare(
      'SELECT * FROM tbl_te_location WHERE eid = ?'
    );
    const statsStmt = world.db.prepare(
      'SELECT * FROM tbl_te_stats WHERE eid = ?'
    );

    expect(locationStmt.get(entity.id)).toBeDefined();
    expect(statsStmt.get(entity.id)).toBeDefined();

    // Delete entity
    deleteEntity(entity);

    // Verify entity is marked for deletion but not yet removed from database
    expect(getEntity(world, entity.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    expect(getEntity(world, entity.id)).toBeNull();

    // Verify components are cascade deleted from database
    expect(locationStmt.get(entity.id)).toBeNull();
    expect(statsStmt.get(entity.id)).toBeNull();
  });

  test('deleteEntity should handle multiple entities independently', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity1 = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });
    const entity2 = createEntity(world, {
      teStats: { health: 80, level: 2, mana: 40 }
    });
    const entity3 = createEntity(world, {
      teStats: { health: 120, level: 3, mana: 60 }
    });

    flush(world);

    // Verify all entities exist
    expect(getEntity(world, entity1.id)).toBeDefined();
    expect(getEntity(world, entity2.id)).toBeDefined();
    expect(getEntity(world, entity3.id)).toBeDefined();

    // Delete middle entity
    deleteEntity(entity2);

    // Verify middle entity is marked for deletion but not yet removed from database
    expect(getEntity(world, entity1.id)).toBeDefined();
    expect(getEntity(world, entity2.id)).toBeDefined();
    expect(getEntity(world, entity3.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify only middle entity is now removed
    expect(getEntity(world, entity1.id)).toBeDefined();
    expect(getEntity(world, entity2.id)).toBeNull();
    expect(getEntity(world, entity3.id)).toBeDefined();

    // Verify other entities still work
    expect(entity1.teStats.health).toBe(100);
    expect(entity3.teStats.health).toBe(120);
  });

  test('deleteEntity should return null', async () => {
    const world = builder.build();

    const entity = createEntity(world);

    const result = deleteEntity(entity);

    expect(result).toBeNull();
  });

  test('deleteEntity should work with unflushed entities', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const entity = createEntity(world, {
      teInventory: { capacity: 10, items: '["sword", "potion"]' }
    });

    // Don't flush - entity exists in cache but not in database yet
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.entityCache.has(entity.id)).toBe(true);

    // Delete entity
    deleteEntity(entity);

    // Verify cleanup of caches
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Entity should still exist in database until flush
    expect(getEntity(world, entity.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should work after component modifications', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      teStats: { health: 100, level: 1, mana: 50 }
    });
    flush(world);

    // Modify component
    entity.teStats.health = 90;
    entity.teStats.level = 2;

    expect(world.dirtyEntities.has(entity.id)).toBe(true);

    // Delete entity with pending changes
    deleteEntity(entity);

    // Verify cache cleanup
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Entity should still exist in database until flush
    expect(getEntity(world, entity.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should handle entity with all component types and cascade delete', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .registerComponent(inventoryComponent)
      .build();

    const entity = createEntity(world, {
      teInventory: { capacity: 20, items: '["crown", "scepter", "gold"]' },
      teLocation: { name: 'Castle', region: 'Kingdom' },
      teStats: { health: 150, level: 5, mana: 75 }
    });
    flush(world);

    // Verify all components exist
    expect(entity.teLocation.name).toBe('Castle');
    expect(entity.teStats.health).toBe(150);
    expect(entity.teInventory.capacity).toBe(20);

    // Delete entity
    deleteEntity(entity);

    // Verify cache cleanup
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Entity should still exist in database until flush
    expect(getEntity(world, entity.id)).toBeDefined();

    // Flush to actually delete from database
    flush(world);

    // Verify entity is now removed
    expect(getEntity(world, entity.id)).toBeNull();

    // Verify database cascade delete worked
    const locationStmt = world.db.prepare(
      'SELECT * FROM tbl_te_location WHERE eid = ?'
    );
    const statsStmt = world.db.prepare(
      'SELECT * FROM tbl_te_stats WHERE eid = ?'
    );
    const inventoryStmt = world.db.prepare(
      'SELECT * FROM tbl_te_inventory WHERE eid = ?'
    );

    expect(locationStmt.get(entity.id)).toBeNull();
    expect(statsStmt.get(entity.id)).toBeNull();
    expect(inventoryStmt.get(entity.id)).toBeNull();
  });
});
