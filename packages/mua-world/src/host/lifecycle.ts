import { scheduleTimer, timersOf, type Timer } from 'ecs-engine';
import { get, put, query, type Eid, type Store } from 'odgn-ecs/store';

/**
 * Homes and mua's own timers, as `MuaWorld.Lifecycle`. Every located thing
 * gets a home, where it starts, so a reset can put it back; what a reset
 * does is the `lifecycle` Service Script's. `timers { every: { message:
 * seconds } }` are kept as the engine's timers under `mua:timers`, one
 * interval apart.
 */
export const TIMERS_SCRIPT = 'mua:timers';

/** Gives every located thing without one a home: where it is now */
export const recordHomes = (store: Store) => {
  for (const eid of query(store, { with: ['location'] })) {
    if (
      !get(store, eid, 'home') &&
      !get(store, eid, 'player') &&
      !get(store, eid, 'portal')
    ) {
      put(store, eid, 'home', { in: get(store, eid, 'location')!.in });
    }
  }
};

/** The seconds between an entity's `message` timers, if it has them */
export const interval = (store: Store, owner: Eid, message: string) => {
  const every = get(store, owner, 'timers')?.every as
    Record<string, unknown> | undefined;
  const seconds = every?.[message];
  return typeof seconds === 'number' && seconds > 0 ? seconds : undefined;
};

const store_ = (store: Store, owner: Eid, message: string, at: number) =>
  scheduleTimer(store, {
    at,
    message,
    name: message,
    owner,
    script: TIMERS_SCRIPT
  });

/**
 * Stores the first of each entity's `timers`, one interval from `nowUs`,
 * unless one is stored already, as after a restart
 */
export const armLifecycle = (store: Store, nowUs: number) => {
  const stored = new Set(
    timersOf(store, TIMERS_SCRIPT).map(t => `${t.owner} ${t.name}`)
  );
  for (const owner of query(store, { with: ['timers'] })) {
    const every =
      (get(store, owner, 'timers')?.every as Record<string, unknown>) ?? {};
    for (const message of Object.keys(every)) {
      const seconds = interval(store, owner, message);
      if (seconds !== undefined && !stored.has(`${owner} ${message}`)) {
        store_(store, owner, message, nowUs + Math.round(seconds * 1_000_000));
      }
    }
  }
};

/**
 * The next of a timer that has fallen due: one interval after it, or, after
 * a long pause, once rather than once per interval missed
 */
export const rearm = (store: Store, timer: Timer, nowUs: number) => {
  const seconds = interval(store, timer.owner, timer.message);
  if (seconds !== undefined) {
    store_(
      store,
      timer.owner,
      timer.message,
      Math.max(timer.at + Math.round(seconds * 1_000_000), nowUs + 1)
    );
  }
};
