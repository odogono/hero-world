import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '@db';
import { queryEntities } from '@entity';
import { createEventSystem, eventComponent } from '@events';
import { createWorld, flush, saveWorld } from '@world';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () => await createWorld({ dbType });

describe('EventSystem', () => {
  test('should create event system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    expect(eventSystem).toBeDefined();
  });

  test('should schedule events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    // Schedule an event
    const eventEntity = eventSystem.scheduleEvent('test-event', {
      message: 'hello'
    });
    flush(world);

    expect(eventEntity.event.type).toBe('test-event');
    expect(eventEntity.event.isProcessed).toBe(false);
    expect(JSON.parse(eventEntity.event.payload)).toEqual({ message: 'hello' });
  });

  test('should schedule future events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    // Schedule an event for 1 hour in the future
    const futureTime = Date.now() + 60 * 60 * 1000;
    const eventEntity = eventSystem.scheduleEvent(
      'future-event',
      { message: 'future' },
      futureTime
    );
    flush(world);

    expect(eventEntity.event.scheduledAt).toBe(futureTime);
    expect(eventEntity.event.isProcessed).toBe(false);

    // collectEventsByType should not return future events
    const readyEvents = eventSystem.collectEventsByType('future-event');
    expect(readyEvents).toHaveLength(0);
  });

  test('should get pending events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('event1', { data: 1 });
    eventSystem.scheduleEvent('event2', { data: 2 });
    flush(world);

    const pendingEvents = eventSystem.getPendingEvents();
    expect(pendingEvents).toHaveLength(2);
    expect(pendingEvents.every(e => !e.event.isProcessed)).toBe(true);
  });

  test('should get events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('type-a', { data: 1 });
    eventSystem.scheduleEvent('type-b', { data: 2 });
    eventSystem.scheduleEvent('type-a', { data: 3 });
    flush(world);

    const typeAEvents = eventSystem.getEventsByType('type-a');
    expect(typeAEvents).toHaveLength(2);
    expect(typeAEvents.every(e => e.event.type === 'type-a')).toBe(true);

    const typeBEvents = eventSystem.getEventsByType('type-b');
    expect(typeBEvents).toHaveLength(1);
    expect(typeBEvents[0].event.type).toBe('type-b');
  });

  test('should collect events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('event1', { value: 1 });
    eventSystem.scheduleEvent('event2', { value: 2 });
    eventSystem.scheduleEvent('event3', { value: 3 });
    flush(world);

    saveWorld(world, 'world.db');

    // await wait(500);

    // Test collecting events by single type
    const collectedEvents = eventSystem.collectEventsByType('event1');

    expect(collectedEvents).toHaveLength(1);
    expect(collectedEvents[0]?.payload.value).toBe(1);

    // Verify that the collected event is marked as processed in memory
    expect(collectedEvents[0]?.entity.event.isProcessed).toBe(true);

    // Flush to persist the processed status
    flush(world);

    // Verify that events are marked as processed by checking the database
    const pendingEvents = eventSystem.getPendingEvents();
    expect(pendingEvents).toHaveLength(2); // event2 and event3 should still be pending
  });

  test('should handle JSON parse errors gracefully', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    // Manually create an event with invalid JSON
    const eventEntity = eventSystem.scheduleEvent('error-test', {});
    eventEntity.event.payload = '{"malformed": json}';
    flush(world);

    // Should not throw, but should mark event as processed
    const collectedEvents = eventSystem.collectEventsByType('error-test');

    // Flush to persist the processed status
    flush(world);

    // Re-query the entity to get updated data
    const updatedEntities = queryEntities(world, {
      where: `e.id = ${eventEntity.id}`,
      with: ['event']
    });

    // The event should be marked as processed due to the parse error
    expect(updatedEntities[0]?.event.isProcessed).toBeTruthy();
    expect(collectedEvents).toHaveLength(0); // No events collected due to parse error
  });
});
