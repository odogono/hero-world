import { describe, expect, test } from 'bun:test';

import {
  eventComponent,
  getAllEvents,
  getEvents,
  getPendingEvents,
  runEvents,
  scheduleEvent
} from '..';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () =>
  await createWorld([eventComponent], { dbType });

describe('EventSystem', () => {
  test('should schedule events', async () => {
    const world = await createTestWorld();

    // Schedule an event
    const eventEntity = scheduleEvent(world, 'test-event', {
      message: 'hello'
    });
    world.flush();

    expect(eventEntity.event.type).toBe('test-event');

    expect(eventEntity.event.payload).toEqual({ message: 'hello' });
  });

  test('should schedule future events', async () => {
    const world = await createTestWorld();

    // Schedule an event for 1 hour in the future
    const futureTime = world.time + 60 * 60 * 1000;
    const eventEntity = scheduleEvent(
      world,
      'future-event',
      { message: 'future' },
      futureTime
    );
    world.flush();

    expect(eventEntity.event.at).toBe(futureTime);

    // collectEventsByType should not return future events
    const readyEvents = getPendingEvents(world, 'future-event');
    expect(readyEvents).toHaveLength(0);
  });

  test('should get pending events', async () => {
    const world = await createTestWorld();

    scheduleEvent(world, 'event1', { data: 1 });
    scheduleEvent(world, 'event2', { data: 2 });
    world.flush();

    const pendingEvents = getPendingEvents(world, '*');
    expect(pendingEvents).toHaveLength(2);
  });

  test('should get events by type', async () => {
    const world = await createTestWorld();

    scheduleEvent(world, 'type-a', { data: 1 });
    scheduleEvent(world, 'type-b', { data: 2 });
    scheduleEvent(world, 'type-a', { data: 3 });
    world.flush();

    const typeAEvents = getEvents(world, 'type-a');
    expect(typeAEvents).toHaveLength(2);
    expect(typeAEvents.every(e => e.type === 'type-a')).toBe(true);

    const typeBEvents = getEvents(world, 'type-b');
    expect(typeBEvents).toHaveLength(1);
    expect(typeBEvents[0]!.type).toBe('type-b');
  });

  test('should collect events by type', async () => {
    const world = await createTestWorld();

    scheduleEvent(world, 'event1', { value: 1 });
    scheduleEvent(world, 'event2', { value: 2 });
    scheduleEvent(world, 'event3', { value: 3 });
    world.flush();

    // saveWorld(world, 'world.db');

    // Test collecting events by single type
    const collectedEvents = getAllEvents<{ value: number }>(world, 'event1');

    expect(collectedEvents).toHaveLength(1);
    expect(collectedEvents[0]?.payload.value).toBe(1);
  });

  test('runs the due events of a type', async () => {
    const world = await createTestWorld();

    let readReceivedCount = 0;
    const read = () =>
      runEvents(world, '*', () => {
        readReceivedCount++;
        return false;
      });

    let receivedCount = 0;
    const typeA = () =>
      runEvents(world, 'type-a', () => {
        receivedCount++;
      });

    let allReceivedCount = 0;
    const both = () =>
      runEvents(world, ['type-a', 'type-b'], () => {
        allReceivedCount++;
      });

    scheduleEvent(world, 'type-a', { value: 1 });
    scheduleEvent(world, 'type-b', { value: 2 });
    scheduleEvent(world, 'type-a', { value: 3 });
    world.flush();

    read();
    typeA();
    both();

    expect(readReceivedCount).toBe(3);
    expect(receivedCount).toBe(2);
    expect(allReceivedCount).toBe(1);

    // should not process events again
    typeA();
    expect(receivedCount).toBe(2);
  });
});
