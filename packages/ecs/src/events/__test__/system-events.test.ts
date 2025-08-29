import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

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
  name: 'test' as const,
  schema: {
    value: z.number()
  }
});

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld({ dbType });

describe('System Events Integration', () => {
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

    gameLoop.addSystem('test-system', testSystem);

    // Schedule an event for the system
    eventSystem.scheduleEvent('test-system', 'test-event', {
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

  test('should process events only for target system', async () => {
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

    // Schedule events for different systems
    eventSystem.scheduleEvent('system1', 'event-for-1', { data: 1 });
    eventSystem.scheduleEvent('system2', 'event-for-2', { data: 2 });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Each system should only receive its own events
    expect(system1Events).toHaveLength(1);
    expect(system1Events[0].payload.data).toBe(1);

    expect(system2Events).toHaveLength(1);
    expect(system2Events[0].payload.data).toBe(2);
  });

  test('should handle scheduled events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    const receivedEvents: any[] = [];

    const testSystem = createWorldSystem<any>((_world, _deltaTime, events) => {
      receivedEvents.push(...events);
    });

    gameLoop.addSystem('test-system', testSystem);

    // Schedule an event for 100ms in the future
    const futureTime = Date.now() + 100;
    eventSystem.scheduleEvent(
      'test-system',
      'future-event',
      { message: 'future' },
      futureTime
    );
    flush(world);

    // First update - event should not be processed yet
    gameLoop.update(16);
    expect(receivedEvents).toHaveLength(0);

    // Wait for the scheduled time and update again
    setTimeout(() => {
      gameLoop.update(16);
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload.message).toBe('future');
    }, 150);
  });

  test('should work with entity systems', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    // Create some test entities
    createEntity(world, { test: { value: 10 } });
    createEntity(world, { test: { value: 20 } });
    flush(world);

    const processedEntities: any[] = [];
    let receivedEvents: any[] = [];

    const entitySystem = createSystem(
      (entity, _world, _deltaTime, events) => {
        processedEntities.push(entity);
        receivedEvents = events;
      },
      { with: ['test'] }
    );

    gameLoop.addSystem('entity-system', entitySystem);

    // Schedule an event for the entity system
    eventSystem.scheduleEvent('entity-system', 'process-entities', {
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
    eventSystem.scheduleEvent('event-driven', 'other-event', {});
    flush(world);
    gameLoop.update(16);
    expect(executionCount).toBe(0);

    // Send correct event type - system should execute
    eventSystem.scheduleEvent('event-driven', 'trigger-event', {});
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
    eventSystem.scheduleEvent('regular-system', 'ignored-event', {});
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Regular system should execute normally
    expect(regularSystemExecuted).toBe(true);
  });

  test('should handle multiple events for same system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .registerComponent(testComponent)
      .build();
    const eventSystem = createEventSystem(world);
    const gameLoop = createGameLoop(world, eventSystem);

    const allEvents: any[] = [];

    const testSystem = createWorldSystem<any>((_world, _deltaTime, events) => {
      allEvents.push(...events);
    });

    gameLoop.addSystem('multi-event-system', testSystem);

    // Schedule multiple events for the same system
    eventSystem.scheduleEvent('multi-event-system', 'event1', { id: 1 });
    eventSystem.scheduleEvent('multi-event-system', 'event2', { id: 2 });
    eventSystem.scheduleEvent('multi-event-system', 'event3', { id: 3 });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // System should receive all events
    expect(allEvents).toHaveLength(3);
    expect(allEvents.map(e => e.payload.id)).toEqual([1, 2, 3]);
  });

  test('should handle events from different systems separately', async () => {
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

    // Schedule events for different systems
    eventSystem.scheduleEvent('system1', 'event-for-1', {
      data: 'for-system-1'
    });
    eventSystem.scheduleEvent('system2', 'event-for-2', {
      data: 'for-system-2'
    });
    flush(world);

    // Run the game loop
    gameLoop.update(16);

    // Each system should only receive its own events
    expect(system1Events).toHaveLength(1);
    expect(system1Events[0].payload.data).toBe('for-system-1');

    expect(system2Events).toHaveLength(1);
    expect(system2Events[0].payload.data).toBe('for-system-2');
  });
});
