import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '@db';
import { queryEntities } from '@entity';
import { createEventSystem, eventComponent } from '@events';
import { createWorld, flush } from '@world';

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

  test('should schedule events for systems', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    // Schedule an event for a system
    const eventEntity = eventSystem.scheduleEvent('test-system', 'test-event', {
      message: 'hello'
    });
    flush(world);

    expect(eventEntity.event.type).toBe('test-event');
    expect(eventEntity.event.targetSystem).toBe('test-system');
    expect(eventEntity.event.processed).toBe(false);
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
      'test-system',
      'future-event',
      { message: 'future' },
      futureTime
    );
    flush(world);

    expect(eventEntity.event.scheduledAt).toBe(futureTime);
    expect(eventEntity.event.processed).toBe(false);

    // collectEventsForSystem should not return future events
    const readyEvents = eventSystem.collectEventsForSystem('test-system');
    expect(readyEvents).toHaveLength(0);
  });

  test('should get pending events', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('system1', 'event1', { data: 1 });
    eventSystem.scheduleEvent('system2', 'event2', { data: 2 });
    flush(world);

    const pendingEvents = eventSystem.getPendingEvents();
    expect(pendingEvents).toHaveLength(2);
    expect(pendingEvents.every(e => !e.event.processed)).toBe(true);
  });

  test('should get events by type', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('system1', 'type-a', { data: 1 });
    eventSystem.scheduleEvent('system2', 'type-b', { data: 2 });
    eventSystem.scheduleEvent('system3', 'type-a', { data: 3 });
    flush(world);

    const typeAEvents = eventSystem.getEventsByType('type-a');
    expect(typeAEvents).toHaveLength(2);
    expect(typeAEvents.every(e => e.event.type === 'type-a')).toBe(true);

    const typeBEvents = eventSystem.getEventsByType('type-b');
    expect(typeBEvents).toHaveLength(1);
    expect(typeBEvents[0].event.type).toBe('type-b');
  });

  test.only('should collect events for system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('test-system', 'event1', { value: 1 });
    eventSystem.scheduleEvent('test-system', 'event2', { value: 2 });
    eventSystem.scheduleEvent('other-system', 'event3', { value: 3 });
    flush(world);

    const collectedEvents = eventSystem.collectEventsForSystem('test-system');

    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents[0].payload.value).toBe(1);
    expect(collectedEvents[1].payload.value).toBe(2);

    // Verify that the collected events are marked as processed in memory
    expect(collectedEvents[0].entity.event.processed).toBe(true);
    expect(collectedEvents[1].entity.event.processed).toBe(true);

    // Flush to persist the processed status
    flush(world);

    // Verify that events are marked as processed by checking the database
    const pendingEvents = eventSystem.getPendingEvents();
    expect(pendingEvents).toHaveLength(1); // Only the event for 'other-system' should be pending
  });

  test('should get events for specific system', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    eventSystem.scheduleEvent('system1', 'event-a', { data: 'a' });
    eventSystem.scheduleEvent('system2', 'event-b', { data: 'b' });
    eventSystem.scheduleEvent('system1', 'event-c', { data: 'c' });
    flush(world);

    const system1Events = eventSystem.getEventsForSystem('system1');
    const system2Events = eventSystem.getEventsForSystem('system2');

    expect(system1Events).toHaveLength(2);
    expect(system2Events).toHaveLength(1);
    expect(system1Events.every(e => e.event.targetSystem === 'system1')).toBe(
      true
    );
    expect(system2Events[0].event.targetSystem).toBe('system2');
  });

  test('should handle JSON parse errors gracefully', async () => {
    const world = (await createTestWorld())
      .registerComponent(eventComponent)
      .build();
    const eventSystem = createEventSystem(world);

    // Manually create an event with invalid JSON
    const eventEntity = eventSystem.scheduleEvent(
      'test-system',
      'error-test',
      {}
    );
    eventEntity.event.payload = '{"malformed": json}';
    flush(world);

    // Should not throw, but should mark event as processed
    const collectedEvents = eventSystem.collectEventsForSystem('test-system');

    // Re-query the entity to get updated data
    const updatedEntities = queryEntities(world, {
      where: `e.id = ${eventEntity.id}`,
      with: ['event']
    });

    expect(updatedEntities[0].event.processed).toBeTruthy();
    expect(collectedEvents).toHaveLength(0); // No events collected due to parse error
  });
});
