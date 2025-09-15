import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';
import { DatabaseType } from '@db';
import { createEntity, deleteEntity, queryEntities } from '@entity';
import { createWorld, flush } from '@world';

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
      name: 'alasqlStats' as const,
      schema: {
        health: z.number(),
        level: z.number(),
        mana: z.number()
      }
    });

    const locationComponent = defineComponent({
      name: 'alasqlLocation' as const,
      schema: {
        region: z.string(),
        x: z.number(),
        y: z.number()
      }
    });

    const world = await createWorld([statsComponent, locationComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create an entity with components
    const entity = createEntity(world, {
      alasqlLocation: { region: 'forest', x: 10, y: 20 },
      alasqlStats: { health: 100, level: 5, mana: 50 }
    });

    expect(entity.id).toBeGreaterThan(0);
    expect(entity.alasqlStats.health).toBe(100);
    expect(entity.alasqlLocation.x).toBe(10);

    // Flush changes to database
    flush(world);

    // Query entities
    const entities = queryEntities(world, {
      with: ['alasqlStats', 'alasqlLocation']
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].id).toBe(entity.id);

    world.db.close();
  });

  test('should handle entity deletion with AlasQL', async () => {
    const testComponent = defineComponent({
      name: 'test' as const,
      schema: {
        value: z.string()
      }
    });

    const world = await createWorld([testComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create and delete entity
    const entity = createEntity(world, {
      test: { value: 'delete me' }
    });

    flush(world);

    const entitiesBefore = queryEntities(world, { with: ['test'] });
    expect(entitiesBefore).toHaveLength(1);

    deleteEntity(entity);
    flush(world);

    const entitiesAfter = queryEntities(world, { with: ['test'] });
    expect(entitiesAfter).toHaveLength(0);

    world.db.close();
  });

  test('should handle component updates with AlasQL', async () => {
    const mutableComponent = defineComponent({
      name: 'mutable' as const,
      schema: {
        counter: z.number(),
        name: z.string()
      }
    });

    const world = await createWorld([mutableComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    const entity = createEntity(world, {
      mutable: { counter: 0, name: 'initial' }
    });

    flush(world);

    // Update the component
    entity.mutable.counter = 42;
    entity.mutable.name = 'updated';

    flush(world);

    // Query to verify update
    const allEntities = queryEntities(world, { with: ['mutable'] });
    expect(allEntities).toHaveLength(1);
    expect(allEntities[0].mutable.counter).toBe(42);
    expect(allEntities[0].mutable.name).toBe('updated');

    // Test WHERE clause with reserved words
    const updated = queryEntities(world, {
      where: 'mutable.counter = 42',
      with: ['mutable']
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].mutable.name).toBe('updated');

    world.db.close();
  });

  test('should handle multiple entities with mixed components', async () => {
    const nameComponent = defineComponent({
      name: 'alasqlName',
      schema: {
        first: z.string(),
        last: z.string()
      }
    });

    const ageComponent = defineComponent({
      name: 'alasqlAge',
      schema: {
        years: z.number()
      }
    });

    const world = await createWorld([nameComponent, ageComponent], {
      dbType,
      path: `test_${Date.now()}_${testCounter++}`
    });

    // Create entities with different component combinations
    const person1 = createEntity(world, {
      alasqlAge: { years: 30 },
      alasqlName: { first: 'John', last: 'Doe' }
    });

    const person2 = createEntity(world, {
      alasqlName: { first: 'Jane', last: 'Smith' }
      // No age component
    });

    const person3 = createEntity(world, {
      alasqlAge: { years: 25 }
      // No name component
    });

    flush(world);

    // Query for entities with both components
    const withBoth = queryEntities(world, {
      with: ['alasqlName', 'alasqlAge']
    });
    expect(withBoth).toHaveLength(1);
    expect(withBoth[0].id).toBe(person1.id);

    // Query for entities with just name
    const withName = queryEntities(world, { with: ['alasqlName'] });
    expect(withName).toHaveLength(2);

    // Query for entities with just age
    const withAge = queryEntities(world, { with: ['alasqlAge'] });
    expect(withAge).toHaveLength(2);

    world.db.close();
  });
});
