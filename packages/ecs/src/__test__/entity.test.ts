import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test';
import { createLog } from 'odgn-helpers/log';
import z from 'zod';

import { defineComponent } from '../component';
import { DatabaseType } from '../db';
import { createEntity, deleteEntity, getEntity } from '../entity';
import type { Components, WorldBuilder } from '../types';
import { createWorld, flush } from '../world';

const log = createLog('test-entity');

// NOTE currently breaks earlier registration of entity schema
// z.globalRegistry.clear();

// Component definitions using new system
const statsComponent = defineComponent({
  name: 'te_stats' as const,
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
  name: 'te_inventory' as const,
  schema: {
    capacity: z.number(),
    items: z.string() // JSON string for simplicity
  },
  statements: {
    inventoryByCapacity: 'SELECT * FROM tbl_te_inventory WHERE capacity = ?'
  }
});

const locationComponent = defineComponent({
  name: 'te_location' as const,
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
  let builder: WorldBuilder<Components>;

  beforeEach(async () => {
    builder = await createTestWorld();
  });

  afterEach(() => {
    builder.close();
  });

  test('create entity with components', async () => {
    const stats = defineComponent({
      name: 'stats',
      schema: {
        agility: z.number(),
        strength: z.number()
      }
    });

    const world = builder.registerComponent(stats).build();

    const entity = createEntity(world, {
      stats: {
        agility: 10,
        strength: 20
      }
    });

    expect(entity.stats.strength).toBe(20);
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
      te_location: { name: 'Forest', region: 'North' }
    });

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.te_location).toBeDefined();
    expect(entity.te_location.name).toBe('Forest');
    expect(entity.te_location.region).toBe('North');
  });

  test('createEntity should create entity with stats component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 100, level: 5, mana: 50 }
    });

    expect(entity).toBeDefined();
    expect(entity.te_stats).toBeDefined();
    expect(entity.te_stats.health).toBe(100);
    expect(entity.te_stats.mana).toBe(50);
    expect(entity.te_stats.level).toBe(5);
  });

  test('createEntity should create entity with inventory component', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const items = JSON.stringify(['sword', 'potion', 'key']);
    const entity = createEntity(world, {
      te_inventory: { capacity: 10, items }
    });

    expect(entity).toBeDefined();
    expect(entity.te_inventory).toBeDefined();
    expect(entity.te_inventory.capacity).toBe(10);
    expect(entity.te_inventory.items).toBe(items);
  });

  test('createEntity should create entity with multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      te_location: { name: 'City', region: 'Central' },
      te_stats: { health: 80, level: 3, mana: 30 }
    });

    expect(entity.te_location).toBeDefined();
    expect(entity.te_location.name).toBe('City');
    expect(entity.te_location.region).toBe('Central');

    expect(entity.te_stats).toBeDefined();
    expect(entity.te_stats.health).toBe(80);
    expect(entity.te_stats.mana).toBe(30);
    expect(entity.te_stats.level).toBe(3);
  });

  test('createEntity should track component changes', async () => {
    const world = builder.registerComponent(locationComponent).build();

    const entity = createEntity(world, {
      te_location: { name: 'Forest', region: 'North' }
    });

    // Initial state - entity should be marked as dirty
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_location')).toBe(true);

    // Clear dirty state by flushing
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify component - should mark as dirty again
    entity.te_location.name = 'Mountain';

    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_location')).toBe(true);
    expect(entity.te_location.name).toBe('Mountain');
  });

  test('createEntity should track changes across multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      te_location: { name: 'Village', region: 'East' },
      te_stats: { health: 100, level: 1, mana: 50 }
    });

    // Clear dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify location component
    entity.te_location.name = 'Town';
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_location')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_stats')).toBe(false);

    // Modify stats component
    entity.te_stats.level = 2;
    expect(world.dirtyEntities.get(entity.id)?.has('te_location')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_stats')).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.size).toBe(2);
  });

  test('createEntity should cache components in entityCache', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 75, level: 4, mana: 25 }
    });

    expect(world.entityCache.has(entity.id)).toBe(true);

    const cached = world.entityCache.get(entity.id);
    expect(cached).toBeDefined();
    expect(cached!.te_stats).toBeDefined();
    expect(cached!.te_stats!.data).toBeDefined();
    expect(cached!.te_stats!.data!.health).toBe(75);
    expect(cached!.te_stats!.data!.mana).toBe(25);
    expect(cached!.te_stats!.data!.level).toBe(4);
    expect(cached!.te_stats!.exists).toBe(false); // New component, not yet persisted
  });

  test('createEntity should persist components after flush', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const entity = createEntity(world, {
      te_inventory: { capacity: 5, items: '["apple", "bread"]' }
    });

    // Before flush - component exists but not persisted
    const cacheBefore = world.entityCache.get(entity.id)!.te_inventory!;
    expect(cacheBefore.exists).toBe(false);

    // Flush to persist
    flush(world);

    // await world.db.saveToPath('world.db');

    // After flush - should be marked as existing in database
    const cacheAfter = world.entityCache.get(entity.id)!.te_inventory!;
    expect(cacheAfter.exists).toBe(true);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
  });

  test('createEntity should work with component modifications through proxy', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 100, level: 10, mana: 100 }
    });

    // Clear dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify multiple properties
    entity.te_stats.health = 90;
    entity.te_stats.mana = 80;
    entity.te_stats.level = 11;

    expect(entity.te_stats.health).toBe(90);
    expect(entity.te_stats.mana).toBe(80);
    expect(entity.te_stats.level).toBe(11);
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_stats')).toBe(true);
  });

  test('createEntity should handle different component data types', async () => {
    // Test with string component

    const nameComponent = defineComponent({
      name: 'test_name' as const,
      schema: {
        firstName: z.string(),
        lastName: z.string(),
        title: z.string().optional()
      }
    });

    const world = builder.registerComponent(nameComponent).build();

    const entity = createEntity(world, {
      test_name: { firstName: 'John', lastName: 'Doe', title: 'Sir' }
    });

    expect(entity.test_name).toBeDefined();
    expect(entity.test_name.firstName).toBe('John');
    expect(entity.test_name.lastName).toBe('Doe');
    expect(entity.test_name.title).toBe('Sir');

    // Test modifications
    flush(world);
    entity.test_name.title = 'Lord';
    expect(entity.test_name.title).toBe('Lord');
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
  });

  test('should create world with builder pattern and single component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    expect(world).toBeDefined();
    expect(world.defs.has('te_stats')).toBe(true);
  });

  test('should create world with multiple components using builder pattern', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .registerComponent(inventoryComponent)
      .build();

    expect(world.defs.has('te_location')).toBe(true);
    expect(world.defs.has('te_stats')).toBe(true);
    expect(world.defs.has('te_inventory')).toBe(true);
  });

  test('should create typed entity with single component', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 100, level: 1, mana: 50 }
    });

    expect(entity).toBeDefined();
    expect(entity.id).toBeTypeOf('number');
    expect(entity.te_stats).toBeDefined();
    expect(entity.te_stats.health).toBe(100);
    expect(entity.te_stats.mana).toBe(50);
    expect(entity.te_stats.level).toBe(1);
  });

  test('should create typed entity with multiple components', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    const entity = createEntity(world, {
      te_location: { name: 'Forest', region: 'North' },
      te_stats: { health: 80, level: 3, mana: 30 }
    });

    expect(entity.te_location.name).toBe('Forest');
    expect(entity.te_location.region).toBe('North');
    expect(entity.te_stats.health).toBe(80);
    expect(entity.te_stats.mana).toBe(30);
    expect(entity.te_stats.level).toBe(3);
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
      te_stats: { health: 100, level: 1, mana: 50 }
    });

    // Clear initial dirty state
    flush(world);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

    // Modify component
    entity.te_stats.health = 90;
    entity.te_stats.level = 2;

    expect(entity.te_stats.health).toBe(90);
    expect(entity.te_stats.level).toBe(2);
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.dirtyEntities.get(entity.id)?.has('te_stats')).toBe(true);
  });

  test('should persist typed entity components after flush', async () => {
    const world = builder.registerComponent(inventoryComponent).build();

    const entity = createEntity(world, {
      te_inventory: { capacity: 10, items: '["sword", "shield"]' }
    });

    // Before flush
    const cacheBefore = world.entityCache.get(entity.id)!.te_inventory!;
    expect(cacheBefore.exists).toBe(false);

    // Flush and check
    flush(world);

    const cacheAfter = world.entityCache.get(entity.id)!.te_inventory!;
    expect(cacheAfter.exists).toBe(true);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
  });

  it('should work with custom component statements', async () => {
    const world = builder.registerComponent(statsComponent).build();

    createEntity(world, {
      te_stats: { health: 75, level: 5, mana: 25 }
    });

    flush(world);

    // Test custom statement from component definition
    const def = world.defs.get('te_stats');
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
      te_inventory: { capacity: 15, items: '["sword", "armor", "potion"]' },
      te_location: { name: 'Battlefield', region: 'War Zone' },
      te_stats: { health: 120, level: 8, mana: 10 }
    });

    const mage = createEntity(world, {
      te_inventory: { capacity: 8, items: '["staff", "spellbook", "robe"]' },
      te_location: { name: 'Tower', region: 'Magic District' },
      te_stats: { health: 60, level: 10, mana: 200 }
    });

    flush(world);

    // Verify both entities exist and have correct data
    expect(warrior.te_location.name).toBe('Battlefield');
    expect(warrior.te_stats.health).toBe(120);
    expect(warrior.te_inventory.capacity).toBe(15);

    expect(mage.te_location.name).toBe('Tower');
    expect(mage.te_stats.mana).toBe(200);
    expect(mage.te_inventory.capacity).toBe(8);

    // Modify components
    warrior.te_stats.health = 100;
    mage.te_stats.mana = 180;

    expect(world.dirtyEntities.has(warrior.id)).toBe(true);
    expect(world.dirtyEntities.has(mage.id)).toBe(true);
  });
});

describe('deleteEntity', () => {
  let builder: WorldBuilder<Components>;

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

    // Verify entity is removed
    const e2 = getEntity(world, entity.id);
    expect(e2).toBeNull();
  });

  test('deleteEntity should remove entity with components', async () => {
    const world = builder.registerComponent(locationComponent).build();

    const entity = createEntity(world, {
      te_location: { name: 'Forest', region: 'North' }
    });
    flush(world);

    // Verify entity and component exist
    expect(getEntity(world, entity.id)).toBeDefined();
    expect(entity.te_location.name).toBe('Forest');

    // Delete entity
    deleteEntity(entity);

    // Verify entity is removed
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should clean up entity cache', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 100, level: 1, mana: 50 }
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
      te_stats: { health: 100, level: 1, mana: 50 }
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
      te_location: { name: 'Village', region: 'East' },
      te_stats: { health: 80, level: 3, mana: 30 }
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

    // Verify entity is removed
    expect(getEntity(world, entity.id)).toBeNull();

    // Verify components are cascade deleted from database due to foreign key constraints
    expect(locationStmt.get(entity.id)).toBeNull();
    expect(statsStmt.get(entity.id)).toBeNull();
  });

  test('deleteEntity should handle multiple entities independently', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity1 = createEntity(world, {
      te_stats: { health: 100, level: 1, mana: 50 }
    });
    const entity2 = createEntity(world, {
      te_stats: { health: 80, level: 2, mana: 40 }
    });
    const entity3 = createEntity(world, {
      te_stats: { health: 120, level: 3, mana: 60 }
    });

    flush(world);

    // Verify all entities exist
    expect(getEntity(world, entity1.id)).toBeDefined();
    expect(getEntity(world, entity2.id)).toBeDefined();
    expect(getEntity(world, entity3.id)).toBeDefined();

    // Delete middle entity
    deleteEntity(entity2);

    // Verify only middle entity is removed
    expect(getEntity(world, entity1.id)).toBeDefined();
    expect(getEntity(world, entity2.id)).toBeNull();
    expect(getEntity(world, entity3.id)).toBeDefined();

    // Verify other entities still work
    expect(entity1.te_stats.health).toBe(100);
    expect(entity3.te_stats.health).toBe(120);
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
      te_inventory: { capacity: 10, items: '["sword", "potion"]' }
    });

    // Don't flush - entity exists in cache but not in database yet
    expect(world.dirtyEntities.has(entity.id)).toBe(true);
    expect(world.entityCache.has(entity.id)).toBe(true);

    // Delete entity
    deleteEntity(entity);

    // Verify cleanup
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should work after component modifications', async () => {
    const world = builder.registerComponent(statsComponent).build();

    const entity = createEntity(world, {
      te_stats: { health: 100, level: 1, mana: 50 }
    });
    flush(world);

    // Modify component
    entity.te_stats.health = 90;
    entity.te_stats.level = 2;

    expect(world.dirtyEntities.has(entity.id)).toBe(true);

    // Delete entity with pending changes
    deleteEntity(entity);

    // Verify complete cleanup
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);
    expect(getEntity(world, entity.id)).toBeNull();
  });

  test('deleteEntity should handle entity with all component types and cascade delete', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .registerComponent(inventoryComponent)
      .build();

    const entity = createEntity(world, {
      te_inventory: { capacity: 20, items: '["crown", "scepter", "gold"]' },
      te_location: { name: 'Castle', region: 'Kingdom' },
      te_stats: { health: 150, level: 5, mana: 75 }
    });
    flush(world);

    // Verify all components exist
    expect(entity.te_location.name).toBe('Castle');
    expect(entity.te_stats.health).toBe(150);
    expect(entity.te_inventory.capacity).toBe(20);

    // Delete entity
    deleteEntity(entity);

    // Verify entity and cache cleanup
    expect(getEntity(world, entity.id)).toBeNull();
    expect(world.entityCache.has(entity.id)).toBe(false);
    expect(world.dirtyEntities.has(entity.id)).toBe(false);

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

  test('foreign key constraints are properly created for component tables', async () => {
    const world = builder
      .registerComponent(locationComponent)
      .registerComponent(statsComponent)
      .build();

    // Check that foreign keys are enabled
    const foreignKeysEnabled = world.db.prepare('PRAGMA foreign_keys').get();
    expect(foreignKeysEnabled).toEqual({ foreign_keys: 1 });

    // Check that foreign key constraints exist for location table
    const locationForeignKeys = world.db
      .prepare('PRAGMA foreign_key_list(tbl_te_location)')
      .all();
    expect(locationForeignKeys).toHaveLength(1);

    // expect(locationForeignKeys[0]).toMatchObject({
    //   from: 'eid',
    //   on_delete: 'CASCADE',
    //   table: 'tbl_entity',
    //   to: 'id'
    // });

    // Check that foreign key constraints exist for stats table
    const statsForeignKeys = world.db
      .prepare('PRAGMA foreign_key_list(tbl_te_stats)')
      .all();
    expect(statsForeignKeys).toHaveLength(1);
    // expect(statsForeignKeys[0]).toMatchObject({
    //   from: 'eid',
    //   on_delete: 'CASCADE',
    //   table: 'tbl_entity',
    //   to: 'id'
    // });
  });
});
