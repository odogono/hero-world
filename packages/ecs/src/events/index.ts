import { z } from 'zod';

import { defineComponent } from '@component';
import { createEntity, queryEntities } from '@entity';
import type { Entity, World } from '@types';

// Event component definition
export const eventComponent = defineComponent({
  name: 'event' as const,
  schema: {
    payload: z.string(), // JSON stringified payload
    processed: z.boolean().default(false),
    scheduledAt: z.number(), // timestamp
    targetSystem: z.string(), // system ID to target (required)
    type: z.string()
  }
});

export type EventComponent = z.infer<typeof eventComponent.schema>;

// Simple event system
export class EventSystem {
  private world: World<any>;

  constructor(world: World<any>) {
    this.world = world;
  }

  // Schedule an event for a system
  scheduleEvent<T = any>(
    systemId: string,
    type: string,
    payload: T,
    scheduledAt: number = Date.now()
  ): Entity {
    return createEntity(this.world, {
      event: {
        payload: JSON.stringify(payload),
        processed: false,
        scheduledAt,
        targetSystem: systemId,
        type
      }
    });
  }

  // Publish event immediately to a system (bypasses scheduling)
  publishEvent<T = any>(systemId: string, type: string, payload: T): Entity {
    return this.scheduleEvent(systemId, type, payload);
  }

  // Get all pending events
  getPendingEvents(): Entity<'event'>[] {
    return queryEntities(this.world, {
      where: 'processed = 0',
      with: ['event']
    }) as Entity<'event'>[];
  }

  // Get events by type
  getEventsByType(type: string): Entity<'event'>[] {
    return queryEntities(this.world, {
      where: `type = '${type}'`,
      with: ['event']
    }) as Entity<'event'>[];
  }

  // Get events for a specific system (both processed and unprocessed)
  getEventsForSystem(systemId: string): Entity<'event'>[] {
    return queryEntities(this.world, {
      where: `target_system = '${systemId}'`,
      with: ['event']
    }) as Entity<'event'>[];
  }

  // Collect ready events for a system and return their parsed payloads
  collectEventsForSystem<T = any>(
    systemId: string
  ): Array<{ entity: Entity<'event'>; payload: T; type: string }> {
    const now = Date.now();
    const readyEvents = queryEntities(this.world, {
      where: `target_system = '${systemId}' AND processed = 0 AND scheduled_at <= ${now}`,
      with: ['event']
    });

    // const allEvents = queryEntities(this.world, { with: ['event'] });

    // console.log(
    //   '[EventSystem][collectEventsForSystem] readyEvents',
    //   readyEvents,
    //   'allEvents',
    //   allEvents
    // );
    const events: Array<{ entity: Entity<'event'>; payload: T; type: string }> =
      [];

    for (const entity of readyEvents) {
      try {
        const payload = JSON.parse(entity.event.payload);
        events.push({
          entity,
          payload,
          type: entity.event.type
        });

        // Mark as processed
        entity.event.processed = true;
      } catch (error) {
        console.error('Error parsing event payload:', error);
        // Mark as processed to prevent retries
        entity.event.processed = true;
      }
    }

    // Note: Caller is responsible for calling flush() to persist changes

    return events;
  }
}

// Helper function to create event system
export const createEventSystem = (world: World<any>): EventSystem =>
  new EventSystem(world);
