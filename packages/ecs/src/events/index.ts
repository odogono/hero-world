import { getUnixTime } from 'odgn-helpers/time';
import { z } from 'zod';

import { defineComponent } from '@component';
import { createEntity, queryEntities } from '@entity';
import { dateTimeWithDefault, withIndex } from '@schema';
import type { Components, EntityWithComponents, World } from '@types';

// Event component definition
export const eventComponent = defineComponent({
  name: 'event' as const,
  schema: {
    isProcessed: z.boolean().default(false),
    payload: z.string(), // JSON stringified payload
    scheduledAt: z.number(), // timestamp in seconds (float)
    type: withIndex(z.string()),
    // eslint-disable-next-line perfectionist/sort-objects
    createdAt: dateTimeWithDefault()
  }
});

export type EventComponent = z.infer<typeof eventComponent.schema>;

// Simple event system
export class EventSystem<TComponents extends Components = Components> {
  private world: World<TComponents>;

  constructor(world: World<TComponents>) {
    this.world = world;
  }

  // Build a WHERE clause (and args) that supports:
  // - exact type match (event.type = ?)
  // - wildcard patterns using * and ? (converted to SQL LIKE with % and _)
  // - '*' (or '%') as a catch-all that skips type filtering
  private buildTypeWhereClause(type: string | string[]): {
    args: string[];
    clause: string;
  } {
    const types = Array.isArray(type) ? type : [type];

    // If any entry is a full wildcard, skip type filtering
    if (types.some(t => t === '*' || t === '%')) {
      return { args: [], clause: '1=1' };
    }

    const clauses: string[] = [];
    const args: string[] = [];

    for (const t of types) {
      if (t.includes('*') || t.includes('?')) {
        const pattern = t.replaceAll('*', '%').replaceAll('?', '_');
        clauses.push('event.type LIKE ?');
        args.push(pattern);
      } else {
        clauses.push('event.type = ?');
        args.push(t);
      }
    }

    // Combine with OR across patterns/literals
    const clause =
      clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
    return { args, clause };
  }

  // Schedule an event for a system
  scheduleEvent<T = any>(
    type: string,
    payload: T,
    scheduledAt: number = getUnixTime()
  ): EntityWithComponents<TComponents, 'event'> {
    return createEntity(this.world, {
      event: {
        isProcessed: false,
        payload: JSON.stringify(payload),
        scheduledAt,
        // targetSystem: systemId,
        type
      }
    });
  }

  // Publish event immediately to a system (bypasses scheduling)
  publishEvent<T = any>(
    // systemId: string,
    type: string,
    payload: T
  ): EntityWithComponents<TComponents, 'event'> {
    return this.scheduleEvent(type, payload);
  }

  // Get all pending events
  getPendingEvents(): Array<EntityWithComponents<TComponents, 'event'>> {
    return queryEntities(this.world, {
      where: 'is_processed = 0',
      with: ['event']
    }) as Array<EntityWithComponents<TComponents, 'event'>>;
  }

  // Get events by type
  getEventsByType(
    type: string | string[]
  ): Array<EntityWithComponents<TComponents, 'event'>> {
    const { args, clause } = this.buildTypeWhereClause(type);
    return queryEntities(this.world, {
      args,
      where: clause,
      with: ['event']
    }) as Array<EntityWithComponents<TComponents, 'event'>>;
  }

  // Get events for a specific system (both processed and unprocessed)
  // getEventsForSystem(
  //   systemId: string
  // ): Array<EntityWithComponents<TComponents, 'event'>> {
  //   return queryEntities(this.world, {
  //     where: `target_system = '${systemId}'`,
  //     with: ['event']
  //   }) as Array<EntityWithComponents<TComponents, 'event'>>;
  // }

  // Collect ready events for a system and return their parsed payloads
  collectEventsByType<T = any>(
    type: string | string[]
  ): Array<{
    entity: EntityWithComponents<TComponents, 'event'>;
    payload: T;
    type: string;
  }> {
    const { args, clause } = this.buildTypeWhereClause(type);

    // Compare scheduled_at against current time in milliseconds. This supports
    // events scheduled in either seconds or milliseconds: second-based
    // timestamps are always <= now in ms once created.
    const readyEvents = queryEntities(this.world, {
      args,
      where: `${clause} AND event.is_processed = 0 AND event.scheduled_at <= (CAST(strftime('%s', 'now') AS REAL) * 1000)`,
      with: ['event']
    });

    // const allEvents = queryEntities(this.world, { with: ['event'] });

    // console.log(
    //   '[EventSystem][collectEventsForSystem] readyEvents',
    //   readyEvents,
    //   'allEvents',
    //   allEvents
    // );
    const events: Array<{
      entity: EntityWithComponents<TComponents, 'event'>;
      payload: T;
      type: string;
    }> = [];

    for (const entity of readyEvents) {
      if (!entity.event) {
        continue;
      }

      try {
        const payload = JSON.parse(entity.event.payload);
        events.push({
          entity: entity as EntityWithComponents<TComponents, 'event'>,
          payload,
          type: entity.event.type
        });

        // Mark as processed
        entity.event.isProcessed = true;
      } catch {
        // console.error('Error parsing event payload:', error);
        // Mark as processed to prevent retries
        entity.event.isProcessed = true;
      }
    }

    // Note: Caller is responsible for calling flush() to persist changes

    return events;
  }

  // Collect all ready events regardless of type
  collectAllEvents<T = any>(): Array<{
    entity: EntityWithComponents<TComponents, 'event'>;
    payload: T;
    type: string;
  }> {
    const readyEvents = queryEntities(this.world, {
      where: `event.is_processed = 0 AND event.scheduled_at <= (CAST(strftime('%s', 'now') AS REAL) * 1000)`,
      with: ['event']
    });

    const events: Array<{
      entity: EntityWithComponents<TComponents, 'event'>;
      payload: T;
      type: string;
    }> = [];

    for (const entity of readyEvents) {
      if (!entity.event) {
        continue;
      }

      try {
        const payload = JSON.parse(entity.event.payload);
        events.push({
          entity: entity as EntityWithComponents<TComponents, 'event'>,
          payload,
          type: entity.event.type
        });

        // Mark as processed
        entity.event.isProcessed = true;
      } catch {
        // Mark as processed to prevent retries
        entity.event.isProcessed = true;
      }
    }

    // Note: Caller is responsible for calling flush() to persist changes
    return events;
  }
}

// Helper function to create event system
export const createEventSystem = <TComponents extends Components>(
  world: World<TComponents>
): EventSystem<TComponents> => new EventSystem(world);
