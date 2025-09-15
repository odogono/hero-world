import { describe, expect, test } from 'bun:test';

import { defineComponent, removeComponent, s } from '@component';
import { DatabaseType } from '@db';
import {
  createEntity,
  queryEntities,
  queryEntitiesIterator,
  queryEntity
} from '@entity';
import type { Components, GenericEntity } from '@types';
import { createWorld, flush } from '@world';

const statusComponent = defineComponent({
  id: 'status' as const,
  schema: {
    status: s.enum(['idle', 'walking', 'fighting', 'dead'])
  }
});

const positionComponent = defineComponent({
  id: 'position' as const,
  schema: {
    x: s.number(),
    y: z.number()
  }
});

const velocityComponent = defineComponent({
  id: 'velocity' as const,
  schema: {
    x: s.number(),
    y: z.number()
  }
});

const nameComponent = defineComponent({
  id: 'name' as const,
  schema: {
    fullName: s.string()
  }
});

const testStateComponent = defineComponent({
  id: 'testState',
  schema: {
    createdAt: s.datetime().default(),
    isComplete: s.boolean().default(false),
    status: s.enum(['pending', 'in_progress', 'completed']).default('pending')
  }
});

const worldOpts = {
  clearExisting: true,
  dbType: (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN,
  path: ':memory:'
};

describe('query', () => {
  test('should query all entities with status component', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const entities = queryEntities(world, { with: ['status'] });
    // console.debug('entities', entities);
    expect(entities).toHaveLength(6);

    const allEntities = queryEntities(world);
    expect(allEntities).toHaveLength(6);
  });

  test('should return component properties with camelCase', async () => {
    const world = await createWorld([nameComponent], worldOpts);
    createEntity(world, { name: { fullName: 'John Doe' } });
    flush(world);
    const entities = queryEntities(world, { with: ['name'] });

    expect(entities[0]!.name!.fullName).toBe('John Doe');
  });

  test('should filter entities with where clause', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const idleEntities = queryEntities(world, {
      where: `status = 'idle'`,
      with: ['status']
    });
    expect(idleEntities).toHaveLength(3);

    const walkingEntities = queryEntities(world, {
      where: `status = 'walking'`,
      with: ['status']
    });
    expect(walkingEntities).toHaveLength(1);

    const activeEntities = queryEntities(world, {
      where: `status IN ('walking', 'fighting')`,
      with: ['status']
    });
    expect(activeEntities).toHaveLength(2);
  });

  test('where clause should support args', async () => {
    const world = await createWorld([statusComponent], worldOpts);
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const entities = queryEntities(world, {
      args: ['fighting'],
      where: 'status = ?1'
    });
    expect(entities).toHaveLength(1);
  });

  test('should query single entity by ID', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    const entity1 = createEntity(world, { status: { status: 'idle' } });

    flush(world);

    const result = queryEntities(world, {
      entity: entity1,
      with: ['status']
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(entity1.id);
    expect(result[0]?.status.status).toBe('idle');
  });

  test('should set a limit on the number of entities returned', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const entities = queryEntities(world, { limit: 2, with: ['status'] });
    expect(entities).toHaveLength(2);
    expect(entities[0]?.status.status).toBe('idle');
    expect(entities[1]?.status.status).toBe('walking');
  });

  test('should set an offset on the number of entities returned', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const entities = queryEntities(world, { offset: 2, with: ['status'] });
    expect(entities).toHaveLength(2);
    expect(entities[0]?.status.status).toBe('fighting');
    expect(entities[1]?.status.status).toBe('dead');
  });

  test('should combine limit and offset options', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });
    createEntity(world, { status: { status: 'idle' } });

    flush(world);

    const entities = queryEntities(world, {
      limit: 2,
      offset: 1,
      with: ['status']
    });
    expect(entities).toHaveLength(2);
    expect(entities[0]?.status.status).toBe('walking');
    expect(entities[1]?.status.status).toBe('fighting');
  });

  test('should return an iterator over the entities', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    world.flush();

    const query = queryEntitiesIterator(world, { with: ['status'] });

    const result: string[] = [];
    for (const entity of query) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['idle', 'walking', 'fighting', 'dead']);
  });

  test('should return an iterator with filtering options', async () => {
    const world = await createWorld([statusComponent], worldOpts);

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    world.flush();

    using entities = queryEntitiesIterator(world, {
      where: `status IN ('walking', 'fighting')`,
      with: ['status']
    });

    const result: string[] = [];
    for (const entity of entities) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['walking', 'fighting']);
  });

  test('iterator should support args in where clause', async () => {
    const world = await createWorld([statusComponent], worldOpts);
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    using entities = queryEntitiesIterator(world, {
      args: ['fighting'],
      where: 'status = ?1',
      with: ['status']
    });

    const result: string[] = [];
    for (const entity of entities) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['fighting']);
  });

  test('query returns entities with both components', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent],
      worldOpts
    );

    createEntity(world, { position: { x: 0, y: 0 } });
    createEntity(world, { position: { x: 1, y: 1 } });
    createEntity(world, { position: { x: 2, y: 2 }, velocity: { x: 3, y: 3 } });

    flush(world);

    const stationary = queryEntities(world, { with: ['position'] });
    expect(stationary).toHaveLength(3);

    const moving = queryEntities(world, { with: ['position', 'velocity'] });
    expect(moving).toHaveLength(1);

    const velocity = queryEntities(world, { with: ['velocity'] });
    expect(velocity).toHaveLength(1);

    // saveWorld(world, './world.db');
  });

  test('should query entities that do not have a specific component', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent],
      worldOpts
    );

    createEntity(world, { position: { x: 0, y: 0 } });
    createEntity(world, { position: { x: 1, y: 1 } });
    createEntity(world, { position: { x: 2, y: 2 }, velocity: { x: 3, y: 3 } });

    flush(world);

    // Query entities with position but without velocity
    const stationary = queryEntities(world, {
      with: ['position'],
      without: ['velocity']
    });
    expect(stationary).toHaveLength(2);
    expect(stationary[0]?.position.x).toBe(0);
    expect(stationary[1]?.position.x).toBe(1);
  });

  test('should query entities that do not have multiple components', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent, statusComponent],
      worldOpts
    );

    createEntity(world, { position: { x: 0, y: 0 } });
    createEntity(world, {
      position: { x: 1, y: 1 },
      status: { status: 'idle' }
    });
    createEntity(world, { position: { x: 2, y: 2 }, velocity: { x: 3, y: 3 } });
    createEntity(world, {
      position: { x: 3, y: 3 },
      status: { status: 'walking' },
      velocity: { x: 4, y: 4 }
    });

    flush(world);

    // Query entities with position but without both velocity and status
    const basic = queryEntities(world, {
      with: ['position'],
      without: ['velocity', 'status']
    });
    expect(basic).toHaveLength(1);
    expect(basic[0]?.position.x).toBe(0);
  });

  test('should combine without with other query options', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent, statusComponent],
      worldOpts
    );

    createEntity(world, { position: { x: 0, y: 0 } });
    createEntity(world, {
      position: { x: 1, y: 1 },
      status: { status: 'idle' }
    });
    createEntity(world, { position: { x: 2, y: 2 }, velocity: { x: 3, y: 3 } });
    createEntity(world, {
      position: { x: 3, y: 3 },
      status: { status: 'walking' },
      velocity: { x: 4, y: 4 }
    });

    flush(world);

    // Query entities with position but without velocity, and limit to 1
    const limited = queryEntities(world, {
      limit: 1,
      with: ['position'],
      without: ['velocity']
    });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.position.x).toBe(0);
  });

  test('should work with iterator queries', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent],
      worldOpts
    );

    createEntity(world, { position: { x: 0, y: 0 } });
    createEntity(world, { position: { x: 1, y: 1 } });
    createEntity(world, { position: { x: 2, y: 2 }, velocity: { x: 3, y: 3 } });

    flush(world);

    const query = queryEntitiesIterator(world, {
      with: ['position'],
      without: ['velocity']
    });

    const result: number[] = [];
    for (const entity of query) {
      result.push(entity.position.x);
    }

    expect(result).toEqual([0, 1]);
  });

  test('should use with option to specify which components to include', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent, statusComponent],
      worldOpts
    );

    createEntity(world, {
      position: { x: 0, y: 0 },
      status: { status: 'walking' },
      velocity: { x: 1, y: 1 }
    });

    flush(world);

    // Query with only position and status, even though entity has velocity
    const result = queryEntities(world, {
      with: ['position', 'status']
    })[0]!;
    expect(result).not.toBeUndefined();
    expect(result.position.x).toBe(0);
    expect(result.status.status).toBe('walking');
    expect(result.velocity).toBeUndefined();
  });

  test('should combine with and without options', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent, statusComponent],
      worldOpts
    );

    createEntity(world, {
      position: { x: 0, y: 0 },
      status: { status: 'walking' },
      velocity: { x: 1, y: 1 }
    });
    createEntity(world, {
      position: { x: 1, y: 1 },
      status: { status: 'idle' }
    });

    flush(world);

    // Query entities with position and status but without velocity
    const result = queryEntities(world, {
      with: ['position', 'status'],
      without: ['velocity']
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.position.x).toBe(1);
    expect(result[0]?.status.status).toBe('idle');
  });

  test('removing components from world should not affect queries', async () => {
    const world = await createWorld(
      [positionComponent, velocityComponent, statusComponent],
      worldOpts
    );

    createEntity(world, {
      position: { x: 0, y: 0 },
      status: { status: 'idle' }
    });
    createEntity(world, { position: { x: 1, y: 1 } });

    flush(world);

    for (const entity of queryEntitiesIterator(world, {
      where: `status.status = 'idle'`,
      with: ['position', 'status']
    })) {
      removeComponent(entity, 'position');
    }

    flush(world);

    const entities = queryEntities(world, { with: ['position', 'status'] });
    expect(entities).toHaveLength(0);

    const statusEntities = queryEntities(world, { with: ['status'] });
    expect(statusEntities).toHaveLength(1);
    expect(statusEntities[0]?.status.status).toBe('idle');
  });

  describe('queryEntity', () => {
    test('should query single entity by ID using queryEntity', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      const entity1 = createEntity(world, { status: { status: 'idle' } });

      flush(world);

      const result = queryEntity(world, {
        entity: entity1,
        with: ['status']
      })!;
      expect(result).not.toBeNull();
      expect(result.id).toBe(entity1.id);
      expect(result.status.status).toBe('idle');
    });

    test('should return null when entity does not exist', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      // Create a fake entity with non-existent ID
      const fakeEntity = {
        id: 999,
        world
      } as unknown as GenericEntity<Components>;

      flush(world);

      const result = queryEntity(world, {
        entity: fakeEntity,
        with: ['status']
      });
      expect(result).toBeNull();
    });

    test('should query single entity with where clause', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });
      createEntity(world, { status: { status: 'fighting' } });

      flush(world);

      const result = queryEntity(world, {
        where: `status = 'walking'`,
        with: ['status']
      });
      expect(result).not.toBeNull();
      expect(result?.status.status).toBe('walking');
    });

    test('should return null when where clause matches no entities', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });

      flush(world);

      const result = queryEntity(world, {
        where: `status = 'dead'`,
        with: ['status']
      });
      expect(result).toBeNull();
    });

    test('should query single entity with args in where clause', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });
      createEntity(world, { status: { status: 'fighting' } });

      flush(world);

      const result = queryEntity(world, {
        args: ['fighting'],
        where: 'status = ?1',
        with: ['status']
      });
      expect(result).not.toBeNull();
      expect(result?.status.status).toBe('fighting');
    });

    test('should query single entity with multiple components', async () => {
      const world = await createWorld(
        [positionComponent, velocityComponent],
        worldOpts
      );

      createEntity(world, { position: { x: 0, y: 0 } });
      createEntity(world, {
        position: { x: 1, y: 1 },
        velocity: { x: 2, y: 2 }
      });

      flush(world);

      const result = queryEntity(world, {
        with: ['position', 'velocity']
      });
      expect(result).not.toBeNull();
      expect(result?.position.x).toBe(1);
      expect(result?.position.y).toBe(1);
      expect(result?.velocity.x).toBe(2);
      expect(result?.velocity.y).toBe(2);
    });

    test('should query single entity with without clause', async () => {
      const world = await createWorld(
        [positionComponent, velocityComponent],
        worldOpts
      );

      createEntity(world, { position: { x: 0, y: 0 } });
      createEntity(world, {
        position: { x: 1, y: 1 },
        velocity: { x: 2, y: 2 }
      });

      flush(world);

      const result = queryEntity(world, {
        with: ['position'],
        without: ['velocity']
      })!;
      expect(result).not.toBeNull();
      expect(result.position.x).toBe(0);
      expect(result.position.y).toBe(0);
      expect(result.velocity).toBeUndefined();
    });

    test('should return null when without clause excludes all entities', async () => {
      const world = await createWorld(
        [positionComponent, velocityComponent],
        worldOpts
      );

      createEntity(world, {
        position: { x: 0, y: 0 },
        velocity: { x: 1, y: 1 }
      });
      createEntity(world, {
        position: { x: 1, y: 1 },
        velocity: { x: 2, y: 2 }
      });

      flush(world);

      const result = queryEntity(world, {
        with: ['position'],
        without: ['velocity']
      });
      expect(result).toBeNull();
    });

    test('should query single entity with offset', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });
      createEntity(world, { status: { status: 'fighting' } });

      flush(world);

      const result = queryEntity(world, {
        offset: 1,
        with: ['status']
      });
      expect(result).not.toBeNull();
      expect(result?.status.status).toBe('walking');
    });

    test('should return null when offset is beyond available entities', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });

      flush(world);

      const result = queryEntity(world, {
        offset: 5,
        with: ['status']
      });
      expect(result).toBeNull();
    });

    test('should query single entity with complex where clause', async () => {
      const world = await createWorld(
        [positionComponent, velocityComponent],
        worldOpts
      );

      createEntity(world, { position: { x: 0, y: 0 } });
      createEntity(world, {
        position: { x: 10, y: 10 },
        velocity: { x: 5, y: 5 }
      });
      createEntity(world, {
        position: { x: 20, y: 20 },
        velocity: { x: 10, y: 10 }
      });

      flush(world);

      const result = queryEntity(world, {
        where: `position.x > 5 AND velocity.x > 3`,
        with: ['position', 'velocity']
      });
      expect(result).not.toBeNull();
      expect(result?.position.x).toBe(10);
      expect(result?.velocity.x).toBe(5);
    });

    test('should query single entity with IN clause', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      createEntity(world, { status: { status: 'idle' } });
      createEntity(world, { status: { status: 'walking' } });
      createEntity(world, { status: { status: 'fighting' } });

      flush(world);

      const result = queryEntity(world, {
        where: `status IN ('walking', 'fighting')`,
        with: ['status']
      });
      expect(result).not.toBeNull();
      expect(['walking', 'fighting']).toContain(result?.status.status);
    });

    test('should query single entity with camelCase component properties', async () => {
      const world = await createWorld([nameComponent], worldOpts);

      createEntity(world, { name: { fullName: 'John Doe' } });
      createEntity(world, { name: { fullName: 'Jane Smith' } });

      flush(world);

      const result = queryEntity(world, {
        where: `name.full_name = 'Jane Smith'`,
        with: ['name']
      })!;
      expect(result).not.toBeNull();
      expect(result.name.fullName).toBe('Jane Smith');
    });

    test('should return null when no entities exist', async () => {
      const world = await createWorld([statusComponent], worldOpts);

      flush(world);

      const result = queryEntity(world, {
        with: ['status']
      });
      expect(result).toBeNull();
    });

    test('should query single entity with multiple without clauses', async () => {
      const world = await createWorld(
        [positionComponent, velocityComponent, statusComponent],
        worldOpts
      );

      createEntity(world, { position: { x: 0, y: 0 } });
      createEntity(world, {
        position: { x: 1, y: 1 },
        status: { status: 'idle' }
      });
      createEntity(world, {
        position: { x: 2, y: 2 },
        velocity: { x: 3, y: 3 }
      });

      flush(world);

      const result = queryEntity(world, {
        with: ['position'],
        without: ['velocity', 'status']
      })!;
      expect(result).not.toBeNull();
      expect(result.position.x).toBe(0);
      expect(result.velocity).toBeUndefined();
      expect(result.status).toBeUndefined();
    });

    test('should retrieve a camelCase component property', async () => {
      const world = await createWorld([testStateComponent], worldOpts);

      createEntity(world, {
        testState: {
          createdAt: new Date().toISOString(),
          isComplete: false,
          status: 'pending'
        }
      });
      flush(world);
      // saveWorld(world, 'testState.world.db');
      const result = queryEntity(world, { with: ['testState'] })!;
      expect(result).not.toBeNull();
      // console.debug('result', result.testState);
      expect(result.testState?.status).toBe('pending');
    });

    test('should automatically apply default values from schema', async () => {
      const world = await createWorld([testStateComponent], worldOpts);
      type TestStateComponent = z.infer<typeof testStateComponent.schema>;
      // This is the original scenario that was failing - create entity with empty testState
      // Defaults should be applied automatically from the Zod schema
      createEntity(world, { testState: {} as unknown as TestStateComponent });
      flush(world);
      const result = queryEntity(world, { with: ['testState'] })!;
      expect(result).not.toBeNull();
      // All fields should have default values applied automatically
      expect(result.testState.status).toBe('pending');
      expect(result.testState.isComplete).toBe(0); // SQLite stores booleans as integers
      expect(result.testState.createdAt).toBeDefined();

      result.testState!.status = 'in_progress';
      flush(world);

      const result2 = queryEntity(world, { with: ['testState'] })!;
      expect(result2).not.toBeNull();
      expect(result2.testState?.status).toBe('in_progress');

      // saveWorld(world, 'test.db');
    });
  });
});
