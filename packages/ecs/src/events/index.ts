import { defineComponent, s, type InferComponentType } from '../component';
import type { Components, EntityWithComponents } from '../types';
import type { World } from '../world';

// Event component definition. An event is due once World time reaches
// `at` (ADR 0019): events run on World time, not the wall clock.
export const eventComponent = defineComponent({
  id: 'event' as const,
  schema: {
    at: s.float().indexed(),
    payload: s.json(),
    type: s.string().indexed()
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

type EventWorld = World<Components & { event: EventComponent }>;

/** Events of `type` whose time has come, earliest first */
const dueEvents = (world: EventWorld, type: string | string[]) => {
  const { args, clause } = buildTypeWhereClause(type);
  return world.queryAll({
    args: [...args, world.time],
    orderBy: [['event', 'at']],
    where: `${clause} AND event.at <= ?`,
    with: ['event'] as const
  });
};

/**
 * Runs `exec` on each event of `type` that is due by World time, earliest
 * first. An event is deleted after it runs unless `exec` returns false.
 * Events are TypeScript-only (ADR 0020), so this is a plain function the
 * caller runs when it chooses, not a System.
 *
 * It flushes when done, unless `flush` is false, as in a Frame loop that
 * commits once per Frame. An event it has run then stays in the database
 * until that flush, so a later `runEvents` before it skips the event.
 */
export const runEvents = <
  TComponents extends Components & { event: EventComponent }
>(
  world: World<TComponents>,
  type: string | string[],
  exec: (props: EventExecProps<TComponents>) => boolean | void,
  { flush = true }: { flush?: boolean } = {}
) => {
  for (const entity of dueEvents(world as unknown as EventWorld, type)) {
    // Run, and deleted, since the last flush
    if (world.entitiesToDelete.has(entity.id)) {
      continue;
    }
    const shouldDelete =
      exec({
        event: entity as unknown as EntityWithComponents<TComponents, 'event'>,
        payload: entity.event.payload,
        type: entity.event.type,
        world
      }) ?? true;
    if (shouldDelete) {
      world.delete(entity);
    }
  }
  if (flush) {
    world.flush();
  }
};

/** Schedule an event for World time `at`, by default now */
export const scheduleEvent = <
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string,
  payload: unknown,
  at?: number
): EntityWithComponents<TComponents, 'event'> => {
  const event: EventComponent = { at: at ?? world.time, payload, type };
  const e = world.create({ event } as Parameters<typeof world.create>[0]);
  return e as EntityWithComponents<TComponents, 'event'>;
};

const toEvents = <TPayload>(
  entities: { event: EventComponent }[]
): Array<EventComponentWithPayload<TPayload>> =>
  // the caller says what the stored payloads are
  entities.map(e => ({ ...e.event, payload: e.event.payload as TPayload }));

/** The events of `type` that are due */
export const getEvents = <
  TPayload = Record<string, unknown>,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
) => toEvents<TPayload>(dueEvents(world as unknown as EventWorld, type));

/** The events of `type` that are due; the same as `getEvents` */
export const getPendingEvents = getEvents;

/** Every event of `type`, due or not, earliest first */
export const getAllEvents = <
  TPayload = Record<string, unknown>,
  TComponents extends Components & { event: EventComponent } = Components & {
    event: EventComponent;
  }
>(
  world: World<TComponents>,
  type: string | string[]
) => {
  const { args, clause } = buildTypeWhereClause(type);
  return toEvents<TPayload>(
    (world as unknown as EventWorld).queryAll({
      args,
      orderBy: [['event', 'at']],
      where: clause,
      with: ['event'] as const
    })
  );
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
