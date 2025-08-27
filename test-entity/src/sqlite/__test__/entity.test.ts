import { test, expect, describe } from 'bun:test';
import { createWorld, flush } from '../world';
import { locationSchema } from '../components/location';
import { createLog } from '@helpers/log';
import { number, string } from 'zod';
import { componentSchema } from '../component';
import { defineComponent } from '../component';
import { createEntity } from '../entity';

const log = createLog('test-entity');

// Define additional component schemas for testing using new system
const statsSchema = componentSchema.extend({
  health: number(),
  level: number(),
  mana: number(),
}).meta({ id: '/stats', name: 'tbl_stats' });

const inventorySchema = componentSchema.extend({
  capacity: number(),
  items: string(), // JSON string for simplicity
}).meta({ id: '/inventory', name: 'tbl_inventory' });

// Component definitions using new system
const statsComponent = defineComponent({
  name: 'stats' as const,
  schema: statsSchema,
  statements: {
    statsByLevel: 'SELECT * FROM tbl_stats WHERE level = ?1'
  }
});

const inventoryComponent = defineComponent({
  name: 'inventory' as const,
  schema: inventorySchema
});

const locationComponent = defineComponent({
  name: 'location' as const,
  schema: locationSchema,
  statements: {
    locationSelectByName: 'SELECT eid as id FROM tbl_locations WHERE name = ?1'
  }
});



describe('createEntity', () => {


test('createEntity should create entity without components', () => {
  const world = createWorld();
  
  const entity = createEntity(world);
  
  expect(entity).toBeDefined();
  expect(entity.id).toBeTypeOf('number');
  expect(entity.id).toBeGreaterThan(0);
  expect(entity.world).toBe(world);
});

test('createEntity should create multiple entities with unique IDs', () => {
  const world = createWorld();
  
  const entity1 = createEntity(world);
  const entity2 = createEntity(world);
  const entity3 = createEntity(world);
  
  expect(entity1.id).not.toBe(entity2.id);
  expect(entity2.id).not.toBe(entity3.id);
  expect(entity1.id).not.toBe(entity3.id);
  
  expect(entity1.id).toBeLessThan(entity2.id);
  expect(entity2.id).toBeLessThan(entity3.id);
});

test('createEntity should create entity with location component', () => {
  const world = createWorld().registerComponent(locationComponent).build();
  
  const entity = createEntity(world, { 
    location: { name: 'Forest', region: 'North' } 
  });
  
  expect(entity).toBeDefined();
  expect(entity.id).toBeTypeOf('number');
  expect(entity.location).toBeDefined();
  expect(entity.location.name).toBe('Forest');
  expect(entity.location.region).toBe('North');
});

test('createEntity should create entity with stats component', () => {
  const world = createWorld().registerComponent(statsComponent).build();
  
  const entity = createEntity(world, { 
    stats: { health: 100, level: 5, mana: 50 } 
  });
  
  expect(entity).toBeDefined();
  expect(entity.stats).toBeDefined();
  expect(entity.stats.health).toBe(100);
  expect(entity.stats.mana).toBe(50);
  expect(entity.stats.level).toBe(5);
});

test('createEntity should create entity with inventory component', () => {
  const world = createWorld().registerComponent(inventoryComponent).build();
  
  const items = JSON.stringify(['sword', 'potion', 'key']);
  const entity = createEntity(world, { 
    inventory: { capacity: 10, items } 
  });
  
  expect(entity).toBeDefined();
  expect(entity.inventory).toBeDefined();
  expect(entity.inventory.capacity).toBe(10);
  expect(entity.inventory.items).toBe(items);
});

test('createEntity should create entity with multiple components', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, { 
    location: { name: 'City', region: 'Central' },
    stats: { health: 80, level: 3, mana: 30 }
  });
  
  expect(entity.location).toBeDefined();
  expect(entity.location.name).toBe('City');
  expect(entity.location.region).toBe('Central');
  
  expect(entity.stats).toBeDefined();
  expect(entity.stats.health).toBe(80);
  expect(entity.stats.mana).toBe(30);
  expect(entity.stats.level).toBe(3);
});

test('createEntity should track component changes', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .build();
  
  const entity = createEntity(world, { 
    location: { name: 'Forest', region: 'North' } 
  });
  
  // Initial state - entity should be marked as dirty
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('location')).toBe(true);
  
  // Clear dirty state by flushing
  flush(world);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
  
  // Modify component - should mark as dirty again
  entity.location.name = 'Mountain';
  
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('location')).toBe(true);
  expect(entity.location.name).toBe('Mountain');
});

test('createEntity should track changes across multiple components', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, { 
    location: { name: 'Village', region: 'East' },
    stats: { health: 100, level: 1, mana: 50 }
  });
  
  // Clear dirty state
  flush(world);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
  
  // Modify location component
  entity.location.name = 'Town';
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('location')).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('stats')).toBe(false);
  
  // Modify stats component
  entity.stats.level = 2;
  expect(world.dirtyEntities.get(entity.id)?.has('location')).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('stats')).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.size).toBe(2);
});

test('createEntity should cache components in entityCache', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, { 
    stats: { health: 75, level: 4, mana: 25 } 
  });
  
  expect(world.entityCache.has(entity.id)).toBe(true);
  
  const cached = world.entityCache.get(entity.id);
  expect(cached).toBeDefined();
  expect(cached!.stats).toBeDefined();
  expect(cached!.stats!.data).toBeDefined();
  expect(cached!.stats!.data!.health).toBe(75);
  expect(cached!.stats!.data!.mana).toBe(25);
  expect(cached!.stats!.data!.level).toBe(4);
  expect(cached!.stats!.exists).toBe(false); // New component, not yet persisted
});

test('createEntity should persist components after flush', () => {
  const world = createWorld().registerComponent(inventoryComponent).build();
  
  const entity = createEntity(world, { 
    inventory: { capacity: 5, items: '["apple", "bread"]' } 
  });
  
  // Before flush - component exists but not persisted
  const cacheBefore = world.entityCache.get(entity.id)!.inventory!;
  expect(cacheBefore.exists).toBe(false);
  
  // Flush to persist
  flush(world);
  
  // After flush - should be marked as existing in database
  const cacheAfter = world.entityCache.get(entity.id)!.inventory!;
  expect(cacheAfter.exists).toBe(true);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
});

test('createEntity should work with component modifications through proxy', () => {
  const world = createWorld().registerComponent(statsComponent).build();
  
  const entity = createEntity(world, { 
    stats: { health: 100, level: 10, mana: 100 } 
  });
  
  // Clear dirty state
  flush(world);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
  
  // Modify multiple properties
  entity.stats.health = 90;
  entity.stats.mana = 80;
  entity.stats.level = 11;
  
  expect(entity.stats.health).toBe(90);
  expect(entity.stats.mana).toBe(80);
  expect(entity.stats.level).toBe(11);
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('stats')).toBe(true);
});

test('createEntity should handle different component data types', () => {
  
  // Test with string component
  const nameSchema = componentSchema.extend({
    firstName: string(),
    lastName: string(),
    title: string().optional(),
  }).meta({ id: '/name', name: 'tbl_names' });

  const nameComponent = defineComponent({
    name: 'name' as const,
    schema: nameSchema
  });
  
  const world = createWorld().registerComponent(nameComponent).build();
  
  const entity = createEntity(world, { 
    name: { firstName: 'John', lastName: 'Doe', title: 'Sir' } 
  });
  
  expect(entity.name).toBeDefined();
  expect(entity.name.firstName).toBe('John');
  expect(entity.name.lastName).toBe('Doe');
  expect(entity.name.title).toBe('Sir');
  
  // Test modifications
  flush(world);
  entity.name.title = 'Lord';
  expect(entity.name.title).toBe('Lord');
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
});

});

describe('WorldBuilder and TypedEntity System', () => {

test('should create world with builder pattern and single component', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  expect(world).toBeDefined();
  expect(world.defs.has('stats')).toBe(true);
});

test('should create world with multiple components using builder pattern', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .registerComponent(statsComponent)
    .registerComponent(inventoryComponent)
    .build();
  
  expect(world.defs.has('location')).toBe(true);
  expect(world.defs.has('stats')).toBe(true);
  expect(world.defs.has('inventory')).toBe(true);
});

test('should create typed entity with single component', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, {
    stats: { health: 100, level: 1, mana: 50 }
  });
  
  expect(entity).toBeDefined();
  expect(entity.id).toBeTypeOf('number');
  expect(entity.stats).toBeDefined();
  expect(entity.stats.health).toBe(100);
  expect(entity.stats.mana).toBe(50);
  expect(entity.stats.level).toBe(1);
});

test('should create typed entity with multiple components', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, {
    location: { name: 'Forest', region: 'North' },
    stats: { health: 80, level: 3, mana: 30 }
  });
  
  expect(entity.location.name).toBe('Forest');
  expect(entity.location.region).toBe('North');
  expect(entity.stats.health).toBe(80);
  expect(entity.stats.mana).toBe(30);
  expect(entity.stats.level).toBe(3);
});

test('should create typed entity without initial components', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world);
  
  expect(entity).toBeDefined();
  expect(entity.id).toBeTypeOf('number');
  expect(entity.world).toBe(world as any);
});

test('should track component changes in typed entities', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, {
    stats: { health: 100, level: 1, mana: 50 }
  });
  
  // Clear initial dirty state
  flush(world);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
  
  // Modify component
  entity.stats.health = 90;
  entity.stats.level = 2;
  
  expect(entity.stats.health).toBe(90);
  expect(entity.stats.level).toBe(2);
  expect(world.dirtyEntities.has(entity.id)).toBe(true);
  expect(world.dirtyEntities.get(entity.id)?.has('stats')).toBe(true);
});

test('should persist typed entity components after flush', () => {
  const world = createWorld()
    .registerComponent(inventoryComponent)
    .build();
  
  const entity = createEntity(world, {
    inventory: { capacity: 10, items: '["sword", "shield"]' }
  });
  
  // Before flush
  const cacheBefore = world.entityCache.get(entity.id)!.inventory!;
  expect(cacheBefore.exists).toBe(false);
  
  // Flush and check
  flush(world);
  
  const cacheAfter = world.entityCache.get(entity.id)!.inventory!;
  expect(cacheAfter.exists).toBe(true);
  expect(world.dirtyEntities.has(entity.id)).toBe(false);
});

test('should work with custom component statements', () => {
  const world = createWorld()
    .registerComponent(statsComponent)
    .build();
  
  const entity = createEntity(world, {
    stats: { health: 75, level: 5, mana: 25 }
  });
  
  flush(world);
  
  // Test custom statement from component definition
  const def = world.defs.get('stats');
  expect(def).toBeDefined();
  expect(def!.statsByLevel).toBeDefined();
  
  // Execute custom statement
  const results = def!.statsByLevel!.all(5);
  expect(results).toBeDefined();
  expect(Array.isArray(results)).toBe(true);
});

test('should handle complex multi-component scenarios', () => {
  const world = createWorld()
    .registerComponent(locationComponent)
    .registerComponent(statsComponent)
    .registerComponent(inventoryComponent)
    .build();
  
  // Create multiple entities
  const warrior = createEntity(world, {
    inventory: { capacity: 15, items: '["sword", "armor", "potion"]' },
    location: { name: 'Battlefield', region: 'War Zone' },
    stats: { health: 120, level: 8, mana: 10 }
  });
  
  const mage = createEntity(world, {
    inventory: { capacity: 8, items: '["staff", "spellbook", "robe"]' },
    location: { name: 'Tower', region: 'Magic District' },
    stats: { health: 60, level: 10, mana: 200 }
  });
  
  flush(world);
  
  // Verify both entities exist and have correct data
  expect(warrior.location.name).toBe('Battlefield');
  expect(warrior.stats.health).toBe(120);
  expect(warrior.inventory.capacity).toBe(15);
  
  expect(mage.location.name).toBe('Tower');
  expect(mage.stats.mana).toBe(200);
  expect(mage.inventory.capacity).toBe(8);
  
  // Modify components
  warrior.stats.health = 100;
  mage.stats.mana = 180;
  
  expect(world.dirtyEntities.has(warrior.id)).toBe(true);
  expect(world.dirtyEntities.has(mage.id)).toBe(true);
});

});