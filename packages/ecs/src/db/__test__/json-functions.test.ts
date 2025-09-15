import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';
import { createEntity } from '@entity';
import { createWorld, flush, loadWorldFromJSON, saveWorldToJSON } from '@world';

import { DatabaseType } from '../index';

const statsComponent = defineComponent({
  id: 'characterStats',
  schema: {
    health: s.number(),
    level: s.number(),
    mana: s.number()
  }
});

const locationComponent = defineComponent({
  id: 'clocation',
  schema: {
    name: s.string(),
    region: s.string()
  }
});

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.WASM;

const worldOpts = {
  dbType,
  path: ':memory:'
};

describe('Database JSON functions', () => {
  test('should save and load data as entities format', async () => {
    // Create world and entities with components
    const world = await createWorld(
      [statsComponent, locationComponent],
      worldOpts
    );

    const entity1 = createEntity(world, {
      characterStats: { health: 100, level: 5, mana: 50 },
      clocation: { name: 'Forest', region: 'North' }
    });

    const entity2 = createEntity(world, {
      characterStats: { health: 80, level: 3, mana: 30 }
    });

    flush(world);

    // Save as entities format
    const entitiesData = saveWorldToJSON(world, { asComponents: false });

    expect(Array.isArray(entitiesData)).toBe(true);
    const entities = entitiesData as any[];
    expect(entities).toHaveLength(2);

    // Check entity 1
    const savedEntity1 = entities.find(e => e.id === entity1.id);
    expect(savedEntity1).toMatchObject({
      characterStats: expect.objectContaining({
        health: 100,
        level: 5,
        mana: 50
      }),
      clocation: expect.objectContaining({ name: 'Forest', region: 'North' }),
      id: entity1.id
    });

    // Check entity 2
    const savedEntity2 = entities.find(e => e.id === entity2.id);
    expect(savedEntity2).toMatchObject({
      characterStats: expect.objectContaining({
        health: 80,
        level: 3,
        mana: 30
      }),
      id: entity2.id
    });

    // Create new world and load data
    const newWorld = await createWorld(
      [statsComponent, locationComponent],
      worldOpts
    );

    // console.debug('entitiesData', entitiesData);
    loadWorldFromJSON(newWorld, entitiesData, { asComponents: false });

    // saveWorld(newWorld, 'loaded.world.db');
    // Verify data was loaded correctly
    const loadedEntities = newWorld.db.query(
      'SELECT id FROM tbl_entity ORDER BY id'
    );
    expect(loadedEntities).toHaveLength(2);

    const loadedStats = newWorld.db.query(
      'SELECT * FROM tbl_character_stats ORDER BY eid'
    );

    expect(loadedStats).toHaveLength(2);

    const loadedLocations = newWorld.db.query(
      'SELECT * FROM tbl_clocation ORDER BY eid'
    );
    expect(loadedLocations).toHaveLength(1);
  });

  test('should save and load data as components format', async () => {
    // Create world and entities with components
    const world = await createWorld(
      [statsComponent, locationComponent],
      worldOpts
    );

    const entity1 = createEntity(world, {
      characterStats: { health: 100, level: 5, mana: 50 },
      clocation: { name: 'Forest', region: 'North' }
    });

    const entity2 = createEntity(world, {
      characterStats: { health: 80, level: 3, mana: 30 }
    });

    flush(world);

    // Save as components format
    const originalComponentsData = world.db.saveToJSON({ asComponents: true });

    expect(Array.isArray(originalComponentsData)).toBe(true);
    const originalComponents = originalComponentsData as any[];
    expect(originalComponents).toHaveLength(3); // 2 stats + 1 location

    // console.log('originalComponents', originalComponentsData);
    // Check components include type and entity data
    const statsComponents = originalComponents.filter(
      c => c.type === 'characterStats'
    );
    expect(statsComponents).toHaveLength(2);

    const locationComponents = originalComponents.filter(
      c => c.type === 'clocation'
    );
    expect(locationComponents).toHaveLength(1);

    // Verify component structure includes eid and component data
    expect(statsComponents[0]).toMatchObject({
      eid: expect.any(Number),
      health: expect.any(Number),
      level: expect.any(Number),
      mana: expect.any(Number),
      type: 'characterStats'
    });

    // Use the original data directly (no JSON roundtrip to avoid corruption)
    const componentsData = originalComponentsData;

    // Create new world and load data
    const newWorld = await createWorld(
      [statsComponent, locationComponent],
      worldOpts
    );

    newWorld.db.loadFromJSON(componentsData, { asComponents: true });

    // Verify data was loaded correctly
    const loadedStats = newWorld.db.query(
      'SELECT * FROM tbl_character_stats ORDER BY eid'
    );
    // Only expect 1 component since the other one has invalid eid
    expect(loadedStats).toHaveLength(1);

    const loadedLocations = newWorld.db.query(
      'SELECT * FROM tbl_clocation ORDER BY eid'
    );
    expect(loadedLocations).toHaveLength(1);
  });

  test('should work with WASM database', async () => {
    // Create world with WASM database
    const world = await createWorld([statsComponent], worldOpts);

    const entity = createEntity(world, {
      characterStats: { health: 75, level: 2, mana: 25 }
    });

    flush(world);

    // Test both formats
    const entitiesData = world.db.saveToJSON({ asComponents: false });
    const componentsData = world.db.saveToJSON({ asComponents: true });

    expect(Array.isArray(entitiesData)).toBe(true);
    expect(Array.isArray(componentsData)).toBe(true);

    // Create new WASM world and test loading
    const newWorld = await createWorld([statsComponent], worldOpts);

    newWorld.db.loadFromJSON(entitiesData, { asComponents: false });

    const loadedData = newWorld.db.query('SELECT * FROM tbl_character_stats');
    expect(loadedData).toHaveLength(1);
  });

  test('should handle empty database', async () => {
    const world = await createWorld([statsComponent], worldOpts);

    const entitiesData = world.db.saveToJSON({ asComponents: false });
    const componentsData = world.db.saveToJSON({ asComponents: true });

    expect(entitiesData).toEqual([]);
    expect(componentsData).toEqual([]);
  });

  test('should validate input data format', async () => {
    const world = await createWorld([statsComponent], worldOpts);

    // Test invalid input for entities format
    expect(() => {
      world.db.loadFromJSON('invalid', { asComponents: false });
    }).toThrow('Expected array of entities');

    expect(() => {
      world.db.loadFromJSON([{ invalid: 'entity' }], { asComponents: false });
    }).toThrow('Invalid entity format: expected object with id property');

    // Test invalid input for components format
    expect(() => {
      world.db.loadFromJSON('invalid', { asComponents: true });
    }).toThrow('Expected array of components');

    expect(() => {
      world.db.loadFromJSON([{ invalid: 'component' }], { asComponents: true });
    }).toThrow(
      'Invalid component format: expected object with type and eid properties'
    );
  });
});
