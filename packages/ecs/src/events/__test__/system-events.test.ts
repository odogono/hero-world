import { describe, expect, test } from 'bun:test';
import z from 'zod';

import { defineComponent } from '@component';
import { DatabaseType } from '@db';
import { createEntity } from '@entity';
import {
  createEventDrivenSystem,
  createGameLoop,
  createSystem,
  createWorldSystem,
  ignoreEvents
} from '@system';
import { createWorld, flush } from '@world';

import { createEventSystem, eventComponent } from '..';

// Test components
const testComponent = defineComponent({
  name: 'systemTest',
  schema: {
    value: z.number()
  }
});

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld({ dbType });

describe.skip('System Events Integration', () => {
  test('should create event-aware game loop', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    expect(gameLoop).toBeDefined();
    expect(gameLoop.addSystem).toBeDefined();
    expect(gameLoop.update).toBeDefined();
  });

  test('should pass events to system when executed', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let receivedEvents: any[] = [];

    // Create a system that captures events
    const testSystem = createWorldSystem<any>((_world, _deltaTime, events) => {
      receivedEvents = [...events];
    });

    gameLoop.addSystem('test_system', testSystem);

    // Schedule an event for the system
    eventSystem.scheduleEvent('test-event', {
      message: 'hello'
    });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Check that the system received the event
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe('test-event');
    expect(receivedEvents[0].payload).toEqual({ message: 'hello' });
  });

  test('should process events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let system1Events: any[] = [];
    let system2Events: any[] = [];

    const system1 = createWorldSystem<any>((_world, _deltaTime, events) => {
      system1Events = [...events];
    });

    const system2 = createWorldSystem<any>((_world, _deltaTime, events) => {
      system2Events = [...events];
    });

    gameLoop.addSystem('system1', system1);
    gameLoop.addSystem('system2', system2);

    // Schedule events of different types
    eventSystem.scheduleEvent('event-for-1', { data: 1 });
    eventSystem.scheduleEvent('event-for-2', { data: 2 });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Both systems should receive events based on type, not system targeting
    expect(system1Events.length).toBeGreaterThan(0);
    expect(system2Events.length).toBeGreaterThan(0);
  });

  test('should handle scheduled events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let receivedEvents: any[] = [];

    const entitySystem = createWorldSystem<any>(
      (_world, _deltaTime, events) => {
        receivedEvents = [...events];
      }
    );

    gameLoop.addSystem('entity-system', entitySystem);

    // Schedule an event for 1 second in the future
    const futureTime = Date.now() + 1000;
    eventSystem.scheduleEvent(
      'process-entities',
      {
        action: 'update'
      },
      futureTime
    );
    flush(world);

    // Run the game loop - should not receive future events
    gameLoop.update(16);
    expect(receivedEvents).toHaveLength(0);

    // Wait for the event to be ready and run again
    await new Promise(resolve => setTimeout(resolve, 1100));
    gameLoop.update(16);
    expect(receivedEvents.length).toBeGreaterThan(0);
  });

  test('should work with entity systems', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    // Create some test entities
    createEntity(world, { systemTest: { value: 10 } });
    createEntity(world, { systemTest: { value: 20 } });
    flush(world);

    const processedEntities: any[] = [];
    let receivedEvents: any[] = [];

    const entitySystem = createSystem(
      (entity, _world, _deltaTime, events) => {
        processedEntities.push(entity);
        receivedEvents = events;
      },
      { with: ['systemTest'] }
    );

    gameLoop.addSystem('entity-system', entitySystem);

    // Schedule an event for the entity system
    eventSystem.scheduleEvent('process-entities', {
      action: 'update'
    });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // System should receive both entities and events
    expect(processedEntities).toHaveLength(2);
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].payload.action).toBe('update');
  });

  test('should support event-driven systems', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let executionCount = 0;

    // Create a system that only runs when specific events occur
    const eventDrivenSystem = createEventDrivenSystem(
      ['trigger-event'],
      (_world, _deltaTime, events) => {
        executionCount++;
        expect(events.every(e => e.type === 'trigger-event')).toBe(true);
      }
    );

    gameLoop.addSystem('event-driven', eventDrivenSystem);

    // Run without events - system should not execute
    gameLoop.update(16);
    expect(executionCount).toBe(0);

    // Send wrong event type - system should not execute
    eventSystem.scheduleEvent('other-event', {});
    flush(world);
    gameLoop.update(16);
    expect(executionCount).toBe(0);

    // Send correct event type - system should execute
    eventSystem.scheduleEvent('trigger-event', {});
    flush(world);
    gameLoop.update(16);
    expect(executionCount).toBe(1);
  });

  test('should convert regular systems to ignore events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let regularSystemExecuted = false;

    // Create a regular system that ignores events
    const regularSystem = (_world: any, _deltaTime: number) => {
      regularSystemExecuted = true;
    };

    const eventIgnoringSystem = ignoreEvents(regularSystem);
    gameLoop.addSystem('regular-system', eventIgnoringSystem);

    // Schedule an event (it will be ignored by the wrapped system)
    eventSystem.scheduleEvent('ignored-event', {});
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // System should execute but ignore events
    expect(regularSystemExecuted).toBe(true);
  });

  test('should handle multiple events for same type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let receivedEvents: any[] = [];

    const multiEventSystem = createWorldSystem<any>(
      (_world, _deltaTime, events) => {
        receivedEvents = [...events];
      }
    );

    gameLoop.addSystem('multi-event-system', multiEventSystem);

    // Schedule multiple events of the same type
    eventSystem.scheduleEvent('batch-update', { item: 1 });
    eventSystem.scheduleEvent('batch-update', { item: 2 });
    eventSystem.scheduleEvent('batch-update', { item: 3 });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // System should receive all events of the same type
    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents.every(e => e.type === 'batch-update')).toBe(true);
  });

  test('should handle events from different types separately', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    let system1Events: any[] = [];
    let system2Events: any[] = [];

    const system1 = createWorldSystem<any>((_world, _deltaTime, events) => {
      system1Events = [...events];
    });

    const system2 = createWorldSystem<any>((_world, _deltaTime, events) => {
      system2Events = [...events];
    });

    gameLoop.addSystem('system1', system1);
    gameLoop.addSystem('system2', system2);

    // Schedule events of different types
    eventSystem.scheduleEvent('type-a', { data: 'a' });
    eventSystem.scheduleEvent('type-b', { data: 'b' });
    eventSystem.scheduleEvent('type-a', { data: 'c' });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Both systems should receive events based on type
    expect(system1Events.length).toBeGreaterThan(0);
    expect(system2Events.length).toBeGreaterThan(0);
  });
});
