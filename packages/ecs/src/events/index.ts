import { getUnixTime } from 'odgn-helpers/time';
import { z } from 'zod';

import { defineComponent } from '@component';
import { createEntity, deleteEntity, queryEntities } from '@entity';
import { dateTimeWithDefault, withIndex } from '@schema';
import { createSystem } from '@system';
import type { Components, EntityWithComponents, World } from '@types';

import type { EntityExecProps } from '../system/types';

// Event component definition
export const eventComponent = defineComponent({
  name: 'event' as const,
  schema: {
    payload: z.string().meta({ type: 'json' }), // JSON stringified payload
    scheduledAt: z.number(), // timestamp in seconds (float)
    type: withIndex(z.string()),
    // eslint-disable-next-line perfectionist/sort-objects
    createdAt: dateTimeWithDefault()
  }
});

export type EventComponent = z.infer<typeof eventComponent.schema>;

type EventExecProps<
  TComponents extends Components & { event: EventComponent }
> = {
  event: EntityWithComponents<TComponents, 'event'>;
  payload: unknown;
  type: string;
};

// Helper function to create event system
export const createEventSystem = <
  TComponents extends Components & { event: EventComponent }
>(
  type: string | string[],
  exec: (props: EventExecProps<TComponents>) => void
) => {
  const { args, clause } = buildTypeWhereClause(type);

  const system = createSystem<
    TComponents,
    EntityExecProps<EntityWithComponents<TComponents, 'event'>, TComponents>
  >(
    ({ entity }) => {
      const payload = JSON.parse(entity.event.payload);
      exec({
        event: entity as EntityWithComponents<TComponents, 'event'>,
        payload,
        type: entity.event.type
      });

      deleteEntity(entity);
    },
    {
      args,
      where: `${clause} AND event.scheduled_at <= ((julianday('now') - 2440587.5) * 86400000)`,
      with: ['event'] as const
    }
  );

  return system;
};

// Schedule an event.
export const scheduleEvent = <
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string,
  payload: unknown,
  scheduledAt?: number
): EntityWithComponents<TComponents, 'event'> => {
  const when = scheduledAt ?? getUnixTime();

  const e = createEntity(world, {
    event: {
      createdAt: new Date().toISOString(),
      payload: JSON.stringify(payload),
      scheduledAt: when,
      type
    }
  } as Partial<TComponents>);

  return e as EntityWithComponents<TComponents, 'event'>;
};

/**
 * Returns upcomning events for a given type
 *
 * @param world
 * @param type
 * @returns
 */
export const getEvents = <
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponent> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = queryEntities(world, {
    args,
    where: `${clause} AND event.scheduled_at <= ((julianday('now') - 2440587.5) * 86400000)`,
    with: ['event'] as const
  });

  return entities.map(e => ({
    ...e.event!,
    payload: JSON.parse(e.event!.payload)
  }));
};

export const getAllEvents = <
  TPayload = unknown,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponent> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = queryEntities(world, {
    args,
    where: clause,
    with: ['event'] as const
  });

  return entities.map(e => ({
    ...e.event!,
    payload: JSON.parse(e.event!.payload)
  }));
};

export const getPendingEvents = <
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponent> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = queryEntities(world, {
    args,
    // Ready-to-process events: scheduled_at <= now
    where: `${clause} AND event.scheduled_at <= ((julianday('now') - 2440587.5) * 86400000)`,
    with: ['event'] as const
  });

  return entities.map(e => ({
    ...e.event!,
    payload: JSON.parse(e.event!.payload)
  }));
};

// Build a WHERE clause (and args) that supports:
// - exact type match (event.type = ?)
// - wildcard patterns using * and ? (converted to SQL LIKE with % and _)
// - '*' (or '%') as a catch-all that skips type filtering
const buildTypeWhereClause = (
  type: string | string[]
): {
  args: string[];
  clause: string;
} => {
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
  const clause = clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
  return { args, clause };
};
