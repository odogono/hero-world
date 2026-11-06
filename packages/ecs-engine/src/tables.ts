import type { Eid, Store } from 'odgn-ecs/store';

/**
 * The engine's tables, beside the store's, in the World's database (ADR
 * 0022): World time in `ecs_engine_meta`, timers in `ecs_engine_timers`
 * (`timers.ts`), and the Waiting inputs whose Runs had not ended at the last
 * commit in `ecs_engine_waiting`. They are part of a World file's contract,
 * spelled as `OdgnEcsEngine.Tables` spells them.
 */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS ecs_engine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS ecs_engine_waiting (id INTEGER PRIMARY KEY, actor INTEGER, input TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS ecs_engine_timers (
    id INTEGER PRIMARY KEY,
    owner INTEGER NOT NULL REFERENCES entities (eid) ON DELETE CASCADE,
    script TEXT NOT NULL,
    name TEXT NOT NULL,
    at INTEGER NOT NULL,
    message TEXT NOT NULL,
    args TEXT NOT NULL,
    UNIQUE (owner, script, name)
  )`,
  'CREATE INDEX IF NOT EXISTS ecs_engine_timers_at ON ecs_engine_timers (at)'
];

const rows = <T>(store: Store, sql: string, args: unknown[] = []) =>
  (args.length > 0 ? store.db.query(sql, args) : store.db.query(sql)) as T[];

/**
 * Creates the engine's tables, if they aren't there yet, and moves the
 * timers of a World made before the engine kept them, `talk_timer`
 * entities, into `ecs_engine_timers`.
 */
export const ensureTables = (store: Store) => {
  for (const sql of SCHEMA) {
    store.db.exec(sql);
  }
  if (store.components.has('talk_timer')) {
    store.db.exec(
      'INSERT OR IGNORE INTO ecs_engine_timers (owner, script, name, at, message, args) ' +
        'SELECT owner, script, name, at, message, args FROM c_talk_timer ORDER BY at, eid'
    );
    store.db.exec(
      'DELETE FROM entities WHERE eid IN (SELECT eid FROM c_talk_timer)'
    );
  }
};

/** World time at the last commit, in milliseconds: 0 for a new World */
export const storedWorldTime = (store: Store): number => {
  const [row] = rows<{ value: string }>(
    store,
    "SELECT value FROM ecs_engine_meta WHERE key = 'world_time'"
  );
  return row ? Number(row.value) : 0;
};

export const putWorldTime = (store: Store, ms: number) =>
  store.db.exec(
    "INSERT INTO ecs_engine_meta (key, value) VALUES ('world_time', ?1) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [String(ms)]
  );

export const insertWaiting = (
  store: Store,
  actor: Eid | undefined,
  input: string
): number => {
  store.db.exec(
    'INSERT INTO ecs_engine_waiting (actor, input) VALUES (?1, ?2)',
    [actor ?? null, input]
  );
  return rows<{ id: number }>(store, 'SELECT last_insert_rowid() AS id')[0]!.id;
};

export const deleteWaiting = (store: Store, id: number) =>
  store.db.exec('DELETE FROM ecs_engine_waiting WHERE id = ?1', [id]);

/** A Waiting input as a restart reports it */
export type WaitingRow = { actor: Eid | null; input: string };

/**
 * Takes the Waiting inputs left from before a restart, oldest first, and
 * clears them: their Runs ended with the process that ran them, so the Host
 * decides what to tell their actors (ADR 0014).
 */
export const takeWaiting = (store: Store): WaitingRow[] => {
  const waiting = rows<WaitingRow>(
    store,
    'SELECT actor, input FROM ecs_engine_waiting ORDER BY id'
  );
  store.db.exec('DELETE FROM ecs_engine_waiting');
  return waiting;
};
