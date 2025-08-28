import { describe, expect, test } from 'bun:test';
import z from 'zod';

import { defineComponent, removeComponent } from '../component';
import { createEntity, queryEntities, queryEntitiesIterator } from '../entity';
import { createWorld, flush } from '../world';

const statusComponent = defineComponent({
  name: 'status' as const,
  schema: {
    status: z.enum(['idle', 'walking', 'fighting', 'dead'])
  }
});

const positionComponent = defineComponent({
  name: 'position' as const,
  schema: {
    x: z.number(),
    y: z.number()
  }
});

const velocityComponent = defineComponent({
  name: 'velocity' as const,
  schema: {
    x: z.number(),
    y: z.number()
  }
});

describe('query', () => {
  test('should query all entities with status component', () => {
    const world = createWorld().registerComponent(statusComponent).build();

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const entities = queryEntities(world, { with: ['status'] });
    expect(entities).toHaveLength(6);

    const allEntities = queryEntities(world);
    expect(allEntities).toHaveLength(6);
  });

  test('should filter entities with where clause', () => {
    const world = createWorld().registerComponent(statusComponent).build();

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const idleEntities = queryEntities(world, {
      where: 'status = "idle"',
      with: ['status']
    });
    expect(idleEntities).toHaveLength(3);

    const walkingEntities = queryEntities(world, {
      where: 'status = "walking"',
      with: ['status']
    });
    expect(walkingEntities).toHaveLength(1);

    const activeEntities = queryEntities(world, {
      where: 'status IN ("walking", "fighting")',
      with: ['status']
    });
    expect(activeEntities).toHaveLength(2);
  });

  test('where clause should support args', () => {
    const world = createWorld().registerComponent(statusComponent).build();
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

  test('should query single entity by ID', () => {
    const world = createWorld().registerComponent(statusComponent).build();

    const entity1 = createEntity(world, { status: { status: 'idle' } });

    flush(world);

    const result = queryEntities(world, {
      entity: entity1 as any,
      with: ['status']
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(entity1.id);
    expect(result[0]?.status.status).toBe('idle');
  });

  test('should set a limit on the number of entities returned', () => {
    const world = createWorld().registerComponent(statusComponent).build();

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

  test('should set an offset on the number of entities returned', () => {
    const world = createWorld().registerComponent(statusComponent).build();

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

  test('should combine limit and offset options', () => {
    const world = createWorld().registerComponent(statusComponent).build();

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

  test('should return an iterator over the entities', () => {
    const world = createWorld().registerComponent(statusComponent).build();

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

  test('should return an iterator with filtering options', () => {
    const world = createWorld().registerComponent(statusComponent).build();

    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    world.flush();

    const query = queryEntitiesIterator(world, {
      where: 'status IN ("walking", "fighting")',
      with: ['status']
    });

    const result: string[] = [];
    for (const entity of query) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['walking', 'fighting']);
  });

  test('iterator should support args in where clause', () => {
    const world = createWorld().registerComponent(statusComponent).build();
    createEntity(world, { status: { status: 'idle' } });
    createEntity(world, { status: { status: 'walking' } });
    createEntity(world, { status: { status: 'fighting' } });
    createEntity(world, { status: { status: 'dead' } });

    flush(world);

    const query = queryEntitiesIterator(world, {
      args: ['fighting'],
      where: 'status = ?1',
      with: ['status']
    });

    const result: string[] = [];
    for (const entity of query) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['fighting']);
  });

  test('query returns entities with both components', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .build();

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

  test('should query entities that do not have a specific component', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .build();

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

  test('should query entities that do not have multiple components', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .registerComponent(statusComponent)
      .build();

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

  test('should combine without with other query options', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .registerComponent(statusComponent)
      .build();

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

  test('should work with iterator queries', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .build();

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

  test('should use with option to specify which components to include', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .registerComponent(statusComponent)
      .build();

    createEntity(world, {
      position: { x: 0, y: 0 },
      status: { status: 'walking' },
      velocity: { x: 1, y: 1 }
    });

    flush(world);

    // Query with only position and status, even though entity has velocity
    const result = queryEntities(world, {
      with: ['position', 'status']
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.position.x).toBe(0);
    expect(result[0]?.status.status).toBe('walking');
    expect((result[0] as any).velocity).toBeUndefined();
  });

  test('should combine with and without options', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .registerComponent(statusComponent)
      .build();

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

  test('removing components from world should not affect queries', () => {
    const world = createWorld()
      .registerComponent(positionComponent)
      .registerComponent(velocityComponent)
      .registerComponent(statusComponent)
      .build();

    createEntity(world, {
      position: { x: 0, y: 0 },
      status: { status: 'idle' }
    });
    createEntity(world, { position: { x: 1, y: 1 } });

    flush(world);

    for (const entity of queryEntitiesIterator(world, {
      where: 'status.status = "idle"',
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
});
