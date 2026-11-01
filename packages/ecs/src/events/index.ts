import { getUnixTime } from 'odgn-helpers/time';

import { defineComponent, s, type InferComponentType } from '../component';
import type { ColumnBuilder } from '../component/types';
import { createSystem } from '../system';
import type { EntityExecProps } from '../system/types';
import type { Components, EntityWithComponents } from '../types';
import type { World } from '../world';

// Event component definition
export const eventComponent = defineComponent({
  id: 'event' as const,
  schema: {
    // Any value: stored as text and parsed back on read. The column stays a
    // string, so its definition hash, which saved worlds check, is unchanged.
    payload: s.string() as ColumnBuilder<'string', false, unknown>,
    scheduledAt: s.number(), // timestamp in seconds (float)
    type: s.string().indexed(),
    // eslint-disable-next-line perfectionist/sort-objects
    createdAt: s.datetime()
  }
});

export type EventComponent = InferComponentType<typeof eventComponent>;
/** An event read back by `getEvents` and friends, with its payload's type */
export type EventComponentWithPayload<TPayload = Record<string, unknown>> =
  EventComponent & { payload: TPayload };

type EventExecProps<
  TComponents extends Components & { event: EventComponent }
> = {
  event: EntityWithComponents<TComponents, 'event'>;
  payload: unknown;
  type: string;
  world: World<TComponents>;
};

// Helper function to create event system
export const createEventSystem = <
  TComponents extends Components & { event: EventComponent }
>(
  type: string | string[],
  exec: (props: EventExecProps<TComponents>) => boolean | void
) => {
  const { args, clause } = buildTypeWhereClause(type);

  const system = createSystem<
    TComponents,
    EntityExecProps<EntityWithComponents<TComponents, 'event'>, TComponents>
  >(
    ({ entity, world }) => {
      const payload = entity.event.payload;
      const shouldDelete =
        exec({
          event: entity as EntityWithComponents<TComponents, 'event'>,
          payload,
          type: entity.event.type,
          world
        }) ?? true;

      if (shouldDelete) {
        world.delete(entity);
      }
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

  const event: EventComponent = {
    createdAt: new Date(),
    payload,
    scheduledAt: when,
    type
  };
  const e = world.create({ event } as Parameters<typeof world.create>[0]);

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
  TPayload = Record<string, unknown>,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponentWithPayload<TPayload>> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = world.queryAll({
    args,
    where: `${clause} AND event.scheduled_at <= ((julianday('now') - 2440587.5) * 86400000)`,
    with: ['event'] as const
  });

  // the caller says what the stored payloads are
  return entities.map(e => ({
    ...e.event,
    payload: e.event.payload as TPayload
  }));
};

export const getAllEvents = <
  TPayload = Record<string, unknown>,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponentWithPayload<TPayload>> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = world.queryAll({
    args,
    where: clause,
    with: ['event'] as const
  });

  // the caller says what the stored payloads are
  return entities.map(e => ({
    ...e.event,
    payload: e.event.payload as TPayload
  }));
};

export const getPendingEvents = <
  TPayload = Record<string, unknown>,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
): Array<EventComponentWithPayload<TPayload>> => {
  const { args, clause } = buildTypeWhereClause(type);

  const entities = world.queryAll({
    args,
    // Ready-to-process events: scheduled_at <= now
    where: `${clause} AND event.scheduled_at <= ((julianday('now') - 2440587.5) * 86400000)`,
    with: ['event'] as const
  });

  // the caller says what the stored payloads are
  return entities.map(e => ({
    ...e.event,
    payload: e.event.payload as TPayload
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
  // no types given: match no events
  const clause =
    clauses.length === 0
      ? '0'
      : clauses.length > 1
        ? `(${clauses.join(' OR ')})`
        : clauses[0]!;
  return { args, clause };
};
