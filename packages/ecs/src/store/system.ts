import {
  query,
  select,
  type Data,
  type Eid,
  type QueryOptions,
  type Store
} from './index';

/**
 * A System: logic that runs at its own interval over every entity matching
 * its query (ADR 0018, ADR 0020), as `OdgnEcs.System`.
 *
 * The store keeps no clock and runs nothing by itself. The caller says what
 * the time is, in a unit of its choosing (mua uses World time in
 * milliseconds), asks which Systems are `due`, and runs each with
 * `runSystem`, inside whatever transaction it commits by, such as a Step.
 * When each System last ran is World data, in `ecs_systems`, so a restarted
 * World carries on where it stopped.
 *
 * A System first seen at time `t` runs one interval later, not at once. One
 * that has missed several intervals, as after a long Step, runs once.
 */
export type System<C = unknown, R = unknown> = {
  /** The interval, in the caller's time unit */
  every: number;
  /** Unique among the World's Systems */
  name: string;
  /** Chooses the entities, as `query` does */
  query?: QueryOptions;
  /** Gets the entities, or with `select` each with its data, and `context` */
  run: (entities: Eid[] | [Eid, Record<string, Data>][], context: C) => R;
  /** Component names to read with each entity, as `select` does */
  select?: readonly string[];
};

const SCHEMA =
  'CREATE TABLE IF NOT EXISTS ecs_systems (name TEXT PRIMARY KEY, last_run INTEGER NOT NULL)';

const lastRuns = (store: Store) => {
  store.db.exec(SCHEMA);
  const rows = store.db.query('SELECT name, last_run FROM ecs_systems') as {
    last_run: number;
    name: string;
  }[];
  return new Map(rows.map(({ last_run, name }) => [name, last_run]));
};

const record = (store: Store, name: string, at: number) =>
  store.db.exec(
    'INSERT INTO ecs_systems (name, last_run) VALUES (?1, ?2) ' +
      'ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run',
    [name, at]
  );

/**
 * Records each System the World hasn't seen before as having run at `now`,
 * so it first runs one interval later. A host calls it when the World
 * starts; `due` does it too, for a System added later.
 */
export const armSystems = (
  store: Store,
  systems: readonly Pick<System, 'name'>[],
  now: number
) => {
  const last = lastRuns(store);
  for (const { name } of systems) {
    if (!last.has(name)) {
      record(store, name, now);
    }
  }
};

/** The Systems due at `now`, in the order given */
export const dueSystems = <S extends Pick<System, 'every' | 'name'>>(
  store: Store,
  systems: readonly S[],
  now: number
): S[] => {
  armSystems(store, systems, now);
  const last = lastRuns(store);
  return systems.filter(s => now >= last.get(s.name)! + s.every);
};

/**
 * When the first of `systems` is next due, or undefined for none. A System
 * the World hasn't seen yet isn't counted: it is armed when `dueSystems`
 * first sees it.
 */
export const nextDue = (
  store: Store,
  systems: readonly Pick<System, 'every' | 'name'>[]
): number | undefined => {
  const last = lastRuns(store);
  const times = systems
    .filter(s => last.has(s.name))
    .map(s => last.get(s.name)! + s.every);
  return times.length === 0 ? undefined : Math.min(...times);
};

/**
 * Runs a System over its entities with `context`, and records that it ran
 * at `now`. Returns what its `run` function returns.
 */
export const runSystem = <C, R>(
  store: Store,
  system: System<C, R>,
  now: number,
  context: C
): R => {
  store.db.exec(SCHEMA);
  const options = system.query ?? {};
  const entities = system.select
    ? select(store, system.select, options)
    : query(store, options);
  record(store, system.name, now);
  return system.run(entities, context);
};
