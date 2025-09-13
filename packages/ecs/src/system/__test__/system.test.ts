import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { createWorld, flush } from '@/world';
import { defineComponent } from '@component';
import { DatabaseType } from '@db';
import { createEntity, queryEntitiesIterator } from '@entity';
import { createSystem } from '@system';
import type { ExtractWorldComponents } from '@types';

import type { EntityExecProps } from '../types';

const constitutionComponent = defineComponent({
  name: 'constitution',
  schema: {
    current: z.number(),
    max: z.number()
  }
});

const worldOpts = {
  dbType: DatabaseType.BUN,
  path: ':memory:'
};
describe('Systems', () => {
  const locationComponent = defineComponent({
    name: 'systemLocation',
    schema: {
      name: z.string(),
      region: z.string()
    }
  });

  test('should create a system that processes all entities', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Create some entities
    const entity1 = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });
    const entity2 = createEntity(world, {
      constitution: { current: 75, max: 100 }
    });
    const entity3 = createEntity(world, {
      constitution: { current: 50, max: 100 }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that tracks processed entities
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      { with: ['constitution'] }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify all entities were processed
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).toContain(entity1.id);
    expect(processedEntities).toContain(entity2.id);
    expect(processedEntities).toContain(entity3.id);
  });

  test('should create a system that processes entities with specific components', async () => {
    // Create a world with both health and location components
    const world = await createWorld(
      [constitutionComponent, locationComponent],
      worldOpts
    );
    type C = ExtractWorldComponents<typeof world>;

    // Create entities with different component combinations
    const healthEntity = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });
    const locationEntity = createEntity(world, {
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const fullEntity = createEntity(world, {
      constitution: { current: 75, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that only processes entities with health component
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      { with: ['constitution'] }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify only entities with health component were processed
    expect(processedEntities).toHaveLength(2);
    expect(processedEntities).toContain(healthEntity.id);
    expect(processedEntities).toContain(fullEntity.id);
    expect(processedEntities).not.toContain(locationEntity.id);
  });

  test('should create a system that processes entities with WHERE clause', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Create entities with different health values
    const healthyEntity = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });
    const woundedEntity = createEntity(world, {
      constitution: { current: 50, max: 100 }
    });
    const criticalEntity = createEntity(world, {
      constitution: { current: 10, max: 100 }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that only processes entities with low health
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      {
        where: 'constitution_current < 50',
        with: ['constitution']
      }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify only entities with low health were processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(criticalEntity.id);
    expect(processedEntities).not.toContain(healthyEntity.id);
    expect(processedEntities).not.toContain(woundedEntity.id);
  });

  test('should create a system that respects LIMIT option', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Create multiple entities
    const entities = [];
    for (let i = 0; i < 5; i++) {
      entities.push(
        createEntity(world, {
          constitution: { current: 100 - i * 10, max: 100 }
        })
      );
    }

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that processes only first 3 entities
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      {
        limit: 3,
        with: ['constitution']
      }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify only 3 entities were processed
    expect(processedEntities).toHaveLength(3);
  });

  test('should create a system that respects OFFSET option', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Create multiple entities
    const entities = [];
    for (let i = 0; i < 5; i++) {
      entities.push(
        createEntity(world, {
          constitution: { current: 100 - i * 10, max: 100 }
        })
      );
    }

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that skips first 2 entities
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      entity => {
        processedEntities.push(entity.id);
      },
      {
        offset: 2,
        with: ['constitution']
      }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify entities after offset were processed
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).not.toContain(entities[0]?.id);
    expect(processedEntities).not.toContain(entities[1]?.id);
  });

  test('should create a system that processes entities without specific components', async () => {
    // Create a world with both health and location components
    const world = await createWorld(
      [constitutionComponent, locationComponent],
      worldOpts
    );

    type C = ExtractWorldComponents<typeof world>;

    // Create entities with different component combinations
    const healthEntity = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });
    const locationEntity = createEntity(world, {
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const fullEntity = createEntity(world, {
      constitution: { current: 75, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that processes entities with location but without health component
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      {
        with: ['systemLocation'],
        without: ['constitution']
      }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify only entities with location but without health component were processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(locationEntity.id);
    expect(processedEntities).not.toContain(healthEntity.id);
    expect(processedEntities).not.toContain(fullEntity.id);
  });

  test('should create a system that can modify entity components', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);
    type C = ExtractWorldComponents<typeof world>;

    // Create an entity
    const entity = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });

    // Flush to persist to database
    flush(world);

    // Create a system that heals entities
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        if (entity.constitution.current < entity.constitution.max) {
          entity.constitution.current = Math.min(
            entity.constitution.current + 25,
            entity.constitution.max
          );
        }
      },
      { with: ['constitution'] }
    );

    // Damage the entity first
    if (entity.constitution) {
      entity.constitution.current = 50;
    }
    flush(world);

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify the entity was healed by querying it again
    const healedEntities = queryEntitiesIterator(world, {
      with: ['constitution']
    });
    const healedEntity = Array.from(healedEntities).find(
      e => e.id === entity.id
    );
    expect(healedEntity?.constitution?.current).toBe(75);
  });

  test('should create a system that processes no entities when query returns empty', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Don't create any entities

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      { with: ['constitution'] }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify no entities were processed
    expect(processedEntities).toHaveLength(0);
  });

  test('should create a system that can be called multiple times', async () => {
    // Create a world with health component
    const world = await createWorld([constitutionComponent], worldOpts);

    type C = ExtractWorldComponents<typeof world>;

    // Create an entity
    const entity = createEntity(world, {
      constitution: { current: 100, max: 100 }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      { with: ['constitution'] }
    );

    // Run the system multiple times
    system.exec({ deltaTime: 16, world });
    system.exec({ deltaTime: 16, world });
    system.exec({ deltaTime: 16, world });

    // Verify the entity was processed each time
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).toEqual([entity.id, entity.id, entity.id]);
  });

  test('should create a system that works with complex query options', async () => {
    // Create a world with both health and location components
    const world = await createWorld(
      [constitutionComponent, locationComponent],
      worldOpts
    );

    type C = ExtractWorldComponents<typeof world>;

    // Create entities with different combinations
    const entity1 = createEntity(world, {
      constitution: { current: 100, max: 100 },
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const entity2 = createEntity(world, {
      constitution: { current: 50, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });
    const entity3 = createEntity(world, {
      constitution: { current: 25, max: 100 },
      systemLocation: { name: 'Mountain', region: 'North' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system with complex query options
    const system = createSystem<C, EntityExecProps<C['entity'], C>>(
      ({ entity }) => {
        processedEntities.push(entity.id);
      },
      {
        limit: 1,
        where: `constitution_current < 75 AND system_location.region = 'North'`,
        with: ['constitution', 'systemLocation']
      }
    );

    // Run the system
    system.exec({ deltaTime: 16, world });

    // Verify only the matching entity was processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(entity3.id);

    // saveWorld(world, 'system.world.db');
  });
});
