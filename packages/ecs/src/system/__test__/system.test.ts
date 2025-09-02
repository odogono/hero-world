import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { healthComponent } from '@/components/health';
import { defineComponent } from '@component';
import { DatabaseType } from '@db';
import { createEntity, queryEntitiesIterator } from '@entity';
import { eventComponent } from '@events';
import { createSystem, createWorldSystem } from '@system';
import type { Components, EntityWithComponents, World } from '@types';
import { createWorld, flush, saveWorld } from '@world';

const createTestWorld = async () =>
  await createWorld({ dbType: DatabaseType.BUN });

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
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create some entities
    const entity1 = createEntity(world, { health: { current: 100, max: 100 } });
    const entity2 = createEntity(world, { health: { current: 75, max: 100 } });
    const entity3 = createEntity(world, { health: { current: 50, max: 100 } });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that tracks processed entities
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify all entities were processed
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).toContain(entity1.id);
    expect(processedEntities).toContain(entity2.id);
    expect(processedEntities).toContain(entity3.id);
  });

  test('should create a system that processes entities with specific components', async () => {
    // Create a world with both health and location components
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .registerComponent(locationComponent)
      .build();
    type TestComponents = Components & {
      health: Record<string, unknown>;
      systemLocation: Record<string, unknown>;
    };

    // Create entities with different component combinations
    const healthEntity = createEntity(world, {
      health: { current: 100, max: 100 }
    });
    const locationEntity = createEntity(world, {
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const fullEntity = createEntity(world, {
      health: { current: 75, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that only processes entities with health component
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      { with: ['health'] }
    );

    // Run the system
    system(world, 16, []);

    // Verify only entities with health component were processed
    expect(processedEntities).toHaveLength(2);
    expect(processedEntities).toContain(healthEntity.id);
    expect(processedEntities).toContain(fullEntity.id);
    expect(processedEntities).not.toContain(locationEntity.id);
  });

  test('should create a system that processes entities with WHERE clause', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create entities with different health values
    const healthyEntity = createEntity(world, {
      health: { current: 100, max: 100 }
    });
    const woundedEntity = createEntity(world, {
      health: { current: 50, max: 100 }
    });
    const criticalEntity = createEntity(world, {
      health: { current: 10, max: 100 }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that only processes entities with low health
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      {
        where: 'health_current < 50',
        with: ['health']
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify only entities with low health were processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(criticalEntity.id);
    expect(processedEntities).not.toContain(healthyEntity.id);
    expect(processedEntities).not.toContain(woundedEntity.id);
  });

  test('should create a system that respects LIMIT option', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create multiple entities
    const entities = [];
    for (let i = 0; i < 5; i++) {
      entities.push(
        createEntity(world, { health: { current: 100 - i * 10, max: 100 } })
      );
    }

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that processes only first 3 entities
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      {
        limit: 3,
        with: ['health']
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify only 3 entities were processed
    expect(processedEntities).toHaveLength(3);
  });

  test('should create a system that respects OFFSET option', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create multiple entities
    const entities = [];
    for (let i = 0; i < 5; i++) {
      entities.push(
        createEntity(world, { health: { current: 100 - i * 10, max: 100 } })
      );
    }

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that skips first 2 entities
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      {
        offset: 2,
        with: ['health']
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify entities after offset were processed
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).not.toContain(entities[0]?.id);
    expect(processedEntities).not.toContain(entities[1]?.id);
  });

  test('should create a system that processes entities without specific components', async () => {
    // Create a world with both health and location components
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .registerComponent(locationComponent)
      .build();

    type TestComponents = Components & {
      health: Record<string, unknown>;
      systemLocation: Record<string, unknown>;
    };

    // Create entities with different component combinations
    const healthEntity = createEntity(world, {
      health: { current: 100, max: 100 }
    });
    const locationEntity = createEntity(world, {
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const fullEntity = createEntity(world, {
      health: { current: 75, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system that processes entities with location but without health component
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      {
        with: ['systemLocation'],
        without: ['health']
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify only entities with location but without health component were processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(locationEntity.id);
    expect(processedEntities).not.toContain(healthEntity.id);
    expect(processedEntities).not.toContain(fullEntity.id);
  });

  test('should create a system that can modify entity components', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create an entity
    const entity = createEntity(world, { health: { current: 100, max: 100 } });

    // Flush to persist to database
    flush(world);

    // Create a system that heals entities
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        if (entity.health && entity.health.current < entity.health.max) {
          entity.health.current = Math.min(
            entity.health.current + 25,
            entity.health.max
          );
        }
      },
      { with: ['health'] }
    );

    // Damage the entity first
    if (entity.health) {
      entity.health.current = 50;
    }
    flush(world);

    // Run the system
    system(world, 16, []);

    // Verify the entity was healed by querying it again
    const healedEntities = queryEntitiesIterator(world, { with: ['health'] });
    const healedEntity = Array.from(healedEntities).find(
      e => e.id === entity.id
    );
    expect(healedEntity?.health?.current).toBe(75);
  });

  test('should create a system that processes no entities when query returns empty', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Don't create any entities

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify no entities were processed
    expect(processedEntities).toHaveLength(0);
  });

  test('should create a system that can be called multiple times', async () => {
    // Create a world with health component
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .build();

    type TestComponents = Components & { health: Record<string, unknown> };

    // Create an entity
    const entity = createEntity(world, { health: { current: 100, max: 100 } });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      }
    );

    // Run the system multiple times
    system(world, 16, []);
    system(world, 16, []);
    system(world, 16, []);

    // Verify the entity was processed each time
    expect(processedEntities).toHaveLength(3);
    expect(processedEntities).toEqual([entity.id, entity.id, entity.id]);
  });

  test('should create a system that works with complex query options', async () => {
    // Create a world with both health and location components
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .registerComponent(locationComponent)
      .build();

    type TestComponents = Components & {
      health: Record<string, unknown>;
      systemLocation: Record<string, unknown>;
    };

    // Create entities with different combinations
    const entity1 = createEntity(world, {
      health: { current: 100, max: 100 },
      systemLocation: { name: 'Forest', region: 'North' }
    });
    const entity2 = createEntity(world, {
      health: { current: 50, max: 100 },
      systemLocation: { name: 'Cave', region: 'South' }
    });
    const entity3 = createEntity(world, {
      health: { current: 25, max: 100 },
      systemLocation: { name: 'Mountain', region: 'North' }
    });

    // Flush to persist to database
    flush(world);

    // Track processed entities
    const processedEntities: number[] = [];

    // Create a system with complex query options
    const system = createSystem<TestComponents>(
      (entity: EntityWithComponents<TestComponents, any>) => {
        processedEntities.push(entity.id);
      },
      {
        limit: 1,
        where: `health_current < 75 AND system_location.region = 'North'`,
        with: ['health', 'systemLocation']
      }
    );

    // Run the system
    system(world, 16, []);

    // Verify only the matching entity was processed
    expect(processedEntities).toHaveLength(1);
    expect(processedEntities).toContain(entity3.id);

    saveWorld(world, 'system.world.db');
  });

  test('should create event-aware entity system', async () => {
    const world = (await createTestWorld())
      .registerComponent(healthComponent)
      .registerComponent(eventComponent)
      .build();

    type TestComponents = Components & {
      event: Record<string, unknown>;
      health: Record<string, unknown>;
    };

    // Create entities
    createEntity(world, { health: { current: 100, max: 100 } });
    createEntity(world, { health: { current: 75, max: 100 } });
    flush(world);

    const processedEntities: any[] = [];
    let receivedEvents: any[] = [];

    // Create system that processes entities and events
    const system = createSystem<TestComponents>(
      (
        e: EntityWithComponents<TestComponents, any>,
        _world: World<TestComponents>,
        _deltaTime: number,
        events: any[]
      ) => {
        processedEntities.push(e);
        receivedEvents = events;
      },
      { with: ['health'] }
    );

    // Run system with events
    const mockEvents = [
      { entity: {} as any, payload: { test: 'data' }, type: 'test-event' }
    ];

    system(world, 16, mockEvents);

    expect(processedEntities).toHaveLength(2);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].payload.test).toBe('data');
  });

  test('should create event-aware world system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    let receivedWorld: any = null;
    let receivedDeltaTime: number = 0;
    let receivedEvents: any[] = [];

    const system = createWorldSystem((w, dt, events) => {
      receivedWorld = w;
      receivedDeltaTime = dt;
      receivedEvents = [...events];
    });

    const mockEvents = [
      { entity: {} as any, payload: { action: 'jump' }, type: 'player-action' }
    ];

    system(world, 33, mockEvents);

    expect(receivedWorld).toBe(world);
    expect(receivedDeltaTime).toBe(33);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].payload.action).toBe('jump');
  });
});
