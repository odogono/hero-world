import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '@db';
import {
  createEventSystem,
  eventComponent,
  getAllEvents,
  getEvents,
  getPendingEvents,
  scheduleEvent
} from '@events';
import { createWorld, flush } from '@world';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld({ dbType });

describe('EventSystem', () => {
  test('should create event system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem('*', () => {});

    expect(eventSystem).toBeDefined();
  });

  test('should schedule events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    // Schedule an event
    const eventEntity = scheduleEvent(world, 'test-event', {
      message: 'hello'
    });
    flush(world);

    expect(eventEntity.event.type).toBe('test-event');
    expect(JSON.parse(eventEntity.event.payload)).toEqual({ message: 'hello' });
  });

  test('should schedule future events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    // Schedule an event for 1 hour in the future
    const futureTime = Date.now() + 60 * 60 * 1000;
    const eventEntity = scheduleEvent(
      world,
      'future-event',
      { message: 'future' },
      futureTime
    );
    flush(world);

    expect(eventEntity.event.scheduledAt).toBe(futureTime);

    // collectEventsByType should not return future events
    const readyEvents = getPendingEvents(world, 'future-event');
    expect(readyEvents).toHaveLength(0);
  });

  test('should get pending events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    scheduleEvent(world, 'event1', { data: 1 });
    scheduleEvent(world, 'event2', { data: 2 });
    flush(world);

    const pendingEvents = getPendingEvents(world, '*');
    expect(pendingEvents).toHaveLength(2);
  });

  test('should get events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    scheduleEvent(world, 'type-a', { data: 1 });
    scheduleEvent(world, 'type-b', { data: 2 });
    scheduleEvent(world, 'type-a', { data: 3 });
    flush(world);

    const typeAEvents = getEvents(world, 'type-a');
    expect(typeAEvents).toHaveLength(2);
    expect(typeAEvents.every(e => e.type === 'type-a')).toBe(true);

    const typeBEvents = getEvents(world, 'type-b');
    expect(typeBEvents).toHaveLength(1);
    expect(typeBEvents[0]!.type).toBe('type-b');
  });

  test('should collect events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    scheduleEvent(world, 'event1', { value: 1 });
    scheduleEvent(world, 'event2', { value: 2 });
    scheduleEvent(world, 'event3', { value: 3 });
    flush(world);

    // saveWorld(world, 'world.db');

    // Test collecting events by single type
    const collectedEvents = getAllEvents<{ value: number }>(world, 'event1');

    expect(collectedEvents).toHaveLength(1);
    expect(collectedEvents[0]?.payload.value).toBe(1);
  });

  test('event system processing events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();

    let readReceivedCount = 0;
    const readSystem = createEventSystem('*', () => {
      readReceivedCount++;
      return false;
    });

    let receivedCount = 0;
    const eventSystem = createEventSystem('type-a', ({ type }) => {
      receivedCount++;
    });

    let allReceivedCount = 0;
    const allSystem = createEventSystem(['type-a', 'type-b'], () => {
      allReceivedCount++;
    });

    scheduleEvent(world, 'type-a', { value: 1 });
    scheduleEvent(world, 'type-b', { value: 2 });
    scheduleEvent(world, 'type-a', { value: 3 });
    flush(world);

    readSystem.exec({ deltaTime: 16, world });
    eventSystem.exec({ deltaTime: 16, world });
    allSystem.exec({ deltaTime: 16, world });

    expect(readReceivedCount).toBe(3);
    expect(receivedCount).toBe(2);
    expect(allReceivedCount).toBe(1);

    // should not process events again
    eventSystem.exec({ deltaTime: 16, world });
    expect(receivedCount).toBe(2);
  });
});
