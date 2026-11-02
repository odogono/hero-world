import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '../component';
import { DatabaseType } from '../db';
import { createWorld } from '../world';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.ALASQL;

// Generate unique database name for each test to avoid data persistence issues
let testCounter = 0;
const createTestWorld = async () => {
  const uniqueDbName = `test_${Date.now()}_${testCounter++}`;
  return await createWorld([], {
    dbType,
    path: uniqueDbName
  });
};

describe.skip('ECS with AlasQL Backend', () => {
  test('should create world with AlasQL backend', async () => {
    const world = await createTestWorld();
    expect(world).toBeDefined();
    world.db.close();
  });

  test('should register components and create entities with AlasQL', async () => {
    const statsComponent = defineComponent({
      id: 'alasqlStats' as const,
      schema: {
        health: s.number(),
        level: s.number(),
        mana: s.number()
      }
    });

    const locationComponent = defineComponent({
      id: 'alasqlLocation' as const,
      schema: {
        region: s.string(),
        x: s.number(),
        y: s.number()
      }
    });

    const world = await createWorld([statsComponent, locationComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create an entity with components
    const entity = world.create({
      alasqlLocation: { region: 'forest', x: 10, y: 20 },
      alasqlStats: { health: 100, level: 5, mana: 50 }
    });

    expect(entity.id).toBeGreaterThan(0);
    expect(entity.alasqlStats.health).toBe(100);
    expect(entity.alasqlLocation.x).toBe(10);

    // Flush changes to database
    world.flush();

    // Query entities
    const entities = world.queryAll({
      with: ['alasqlStats', 'alasqlLocation']
    });

    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe(entity.id);

    world.db.close();
  });

  test('should handle entity deletion with AlasQL', async () => {
    const testComponent = defineComponent({
      id: 'test' as const,
      schema: {
        value: s.string()
      }
    });

    const world = await createWorld([testComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create and delete entity
    const entity = world.create({
      test: { value: 'delete me' }
    });

    world.flush();

    const entitiesBefore = world.queryAll({ with: ['test'] });
    expect(entitiesBefore).toHaveLength(1);

    world.delete(entity);
    world.flush();

    const entitiesAfter = world.queryAll({ with: ['test'] });
    expect(entitiesAfter).toHaveLength(0);

    world.db.close();
  });

  test('should handle component updates with AlasQL', async () => {
    const mutableComponent = defineComponent({
      id: 'mutable' as const,
      schema: {
        counter: s.number(),
        name: s.string()
      }
    });

    const world = await createWorld([mutableComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    const entity = world.create({
      mutable: { counter: 0, name: 'initial' }
    });

    world.flush();

    // Update the component
    entity.mutable.counter = 42;
    entity.mutable.name = 'updated';

    world.flush();

    // Query to verify update
    const allEntities = world.queryAll({ with: ['mutable'] });
    expect(allEntities).toHaveLength(1);
    expect(allEntities[0]!.mutable.counter).toBe(42);
    expect(allEntities[0]!.mutable.name).toBe('updated');

    // Test WHERE clause with reserved words
    const updated = world.queryAll({
      where: 'mutable.counter = 42',
      with: ['mutable']
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]!.mutable.name).toBe('updated');

    world.db.close();
  });

  test('should handle multiple entities with mixed components', async () => {
    const nameComponent = defineComponent({
      id: 'alasqlName',
      schema: {
        first: s.string(),
        last: s.string()
      }
    });

    const ageComponent = defineComponent({
      id: 'alasqlAge',
      schema: {
        years: s.number()
      }
    });

    const world = await createWorld([nameComponent, ageComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create entities with different component combinations
    const person1 = world.create({
      alasqlAge: { years: 30 },
      alasqlName: { first: 'John', last: 'Doe' }
    });

    const person2 = world.create({
      alasqlName: { first: 'Jane', last: 'Smith' }
      // No age component
    });

    const person3 = world.create({
      alasqlAge: { years: 25 }
      // No name component
    });

    world.flush();

    // Query for entities with both components
    const withBoth = world.queryAll({
      with: ['alasqlName', 'alasqlAge']
    });
    expect(withBoth).toHaveLength(1);
    expect(withBoth[0]!.id).toBe(person1.id);

    // Query for entities with just name
    const withName = world.queryAll({ with: ['alasqlName'] });
    expect(withName).toHaveLength(2);

    // Query for entities with just age
    const withAge = world.queryAll({ with: ['alasqlAge'] });
    expect(withAge).toHaveLength(2);

    world.db.close();
  });
});
