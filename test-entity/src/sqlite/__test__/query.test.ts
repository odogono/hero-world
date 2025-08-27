import { test, expect, describe } from 'bun:test';
import { defineComponent } from '../component';
import z from 'zod';
import { createWorld, flush, saveWorld } from '../world';
import { createEntity, queryEntities, queryEntitiesIterator } from '../entity';

const statusComponent = defineComponent({
  name: 'status' as const,
  schema: {
    status: z.enum(['idle', 'walking', 'fighting', 'dead']),
  }
});

const positionComponent = defineComponent({
  name: 'position' as const,
  schema: {
    x: z.number(),
    y: z.number(),
  }
});

const velocityComponent = defineComponent({
  name: 'velocity' as const,
  schema: {
    x: z.number(),
    y: z.number(),
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

    const entities = queryEntities(world, ['status']);
    expect(entities).toHaveLength(6);
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
    
    const idleEntities = queryEntities(world, ['status'], { where: 'status = "idle"' });
    expect(idleEntities).toHaveLength(3);

    const walkingEntities = queryEntities(world, ['status'], { where: 'status = "walking"' });
    expect(walkingEntities).toHaveLength(1);

    const activeEntities = queryEntities(world, ['status'], { where: 'status IN ("walking", "fighting")' });
    expect(activeEntities).toHaveLength(2);
  });

  test('should query single entity by ID', () => {
    const world = createWorld().registerComponent(statusComponent).build();

    const entity1 = createEntity(world, { status: { status: 'idle' } });
    const entity2 = createEntity(world, { status: { status: 'walking' } });

    flush(world);
    
    const result = queryEntities(world, ['status'], { entity: entity1 });
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

    const entities = queryEntities(world, ['status'], { limit: 2 });
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

    const entities = queryEntities(world, ['status'], { offset: 2 });
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

    const entities = queryEntities(world, ['status'], { limit: 2, offset: 1 });
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

    const query = queryEntitiesIterator(world, ['status']);

    let result: string[] = [];
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

    const query = queryEntitiesIterator(world, ['status'], { where: 'status IN ("walking", "fighting")' });

    let result: string[] = [];
    for (const entity of query) {
      result.push(entity.status.status);
    }

    expect(result).toEqual(['walking', 'fighting']);
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


    const stationary = queryEntities(world, ['position']);
    expect(stationary).toHaveLength(3);

    const moving = queryEntities(world, ['position', 'velocity']);
    expect(moving).toHaveLength(1);


    // saveWorld(world, './world.db');
  })

});