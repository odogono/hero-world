import { test, expect, describe } from 'bun:test';
import { defineComponent } from '../component';
import z from 'zod';
import { createWorld, flush, saveWorld } from '../world';
import { createEntity, queryEntities } from '../entity';

const statusComponent = defineComponent({
  name: 'status' as const,
  schema: {
    status: z.enum(['idle', 'walking', 'fighting', 'dead']),
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
});