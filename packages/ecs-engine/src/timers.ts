import type { EcsTalk } from 'ecs-talk';
import type { Eid, Store } from 'odgn-ecs/store';

import {
  ScriptError,
  decodeValue,
  defineCapability,
  encodeValue,
  list,
  nothing,
  shape,
  type Call,
  type Value
} from '@northtalk/ts';

/**
 * Durable timers on World time, kept in `ecs_engine_timers` (ADR 0022),
 * and the `timer` Capability Scripts set them with, as
 * `OdgnEcsEngine.Timers`. A timer belongs to an entity, its owner, and goes
 * when the owner is deleted. It is scoped to its owner, a script name and
 * its own name: storing one with the same three replaces it. `at` is in
 * microseconds since the Unix epoch; `args` are encoded Values.
 */
export type Timer = {
  args: string;
  at: number;
  id: number;
  message: string;
  name: string;
  owner: Eid;
  script: string;
};

export type NewTimer = {
  args?: readonly Value[];
  at: number;
  message: string;
  name: string;
  owner: Eid;
  script: string;
};

const COLUMNS = 'id, owner, script, name, at, message, args';

const select = (store: Store, where: string, args: unknown[] = []) =>
  (args.length > 0
    ? store.db.query(`SELECT ${COLUMNS} FROM ecs_engine_timers ${where}`, args)
    : store.db.query(
        `SELECT ${COLUMNS} FROM ecs_engine_timers ${where}`
      )) as Timer[];

/** Removes the timer of this owner, script and name, if there is one */
export const cancelTimer = (
  store: Store,
  owner: Eid,
  script: string,
  name: string
) =>
  store.db.exec(
    'DELETE FROM ecs_engine_timers WHERE owner = ?1 AND script = ?2 AND name = ?3',
    [owner, script, name]
  );

/** Stores a timer, replacing one of the same owner, script and name */
export const scheduleTimer = (store: Store, t: NewTimer) => {
  cancelTimer(store, t.owner, t.script, t.name);
  store.db.exec(
    'INSERT INTO ecs_engine_timers (owner, script, name, at, message, args) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    [
      t.owner,
      t.script,
      t.name,
      t.at,
      t.message,
      encodeValue(list(...(t.args ?? [])))
    ]
  );
};

/** The timers due at or before `nowUs`, earliest first, then oldest first */
export const dueTimers = (store: Store, nowUs: number) =>
  select(store, 'WHERE at <= ?1 ORDER BY at, id', [nowUs]);

/** Every timer stored under `script`, oldest first */
export const timersOf = (store: Store, script: string) =>
  select(store, 'WHERE script = ?1 ORDER BY id', [script]);

/** Every timer `owner` has, oldest first */
export const timersOwnedBy = (store: Store, owner: Eid) =>
  select(store, 'WHERE owner = ?1 ORDER BY id', [owner]);

/** When the earliest timer falls due, in microseconds, or undefined */
export const nextTimerAt = (store: Store): number | undefined => {
  const [row] = store.db.query(
    'SELECT min(at) AS at FROM ecs_engine_timers'
  ) as { at: number | null }[];
  return row?.at ?? undefined;
};

/** Removes a timer without delivering it */
export const removeTimer = (store: Store, timer: Pick<Timer, 'id'>) =>
  store.db.exec('DELETE FROM ecs_engine_timers WHERE id = ?1', [timer.id]);

// A list Value's items; NorthTalk lists count from 1
const items = (v: Value): Value[] =>
  Array.from({ length: v.length }, (_, i) => v.index(i + 1));

/** A timer's args, as the Values they were stored from */
export const timerArgs = (timer: Pick<Timer, 'args'>): Value[] =>
  items(decodeValue(timer.args));

/** Removes a due timer and delivers its message to its owner */
export const fireTimer = (talk: EcsTalk, store: Store, timer: Timer) => {
  removeTimer(store, timer);
  return talk.deliver(timer.owner, timer.message, timerArgs(timer));
};

// A timer a Run sets belongs to the entity its Delivery went to
const ownerOf = (talk: EcsTalk, call: Call<unknown>) => {
  const receiver = talk.delivery(call)?.receiver;
  if (receiver === undefined) {
    throw new ScriptError(
      'invalid value',
      'A timer needs a Run delivered to an entity'
    );
  }
  return receiver;
};

/**
 * The `timer` Capability, for `createEcsTalk`'s `capabilities`: `schedule
 * name, at, message, args` and `cancel name`, for the entity the Run was
 * delivered to.
 */
export const timerCapability = (store: Store) => (talk: EcsTalk) =>
  defineCapability('timer', {
    cancel: {
      args: [shape.text],
      cost: { fuel: 1 },
      fire: (call, name) =>
        cancelTimer(
          store,
          ownerOf(talk, call),
          talk.scriptName(call.scriptName),
          name
        ),
      mode: 'fire-and-forget'
    },
    schedule: {
      args: [shape.text, shape.any, shape.text, shape.any],
      cost: { fuel: 1 },
      fire: (call, name, at, message, args) => {
        const us = at.asInstant();
        if (us === undefined) {
          throw new ScriptError('invalid value', `${at} is not an Instant`);
        }
        scheduleTimer(store, {
          args: args === nothing ? [] : items(args),
          at: Number(us),
          message,
          name,
          owner: ownerOf(talk, call),
          script: talk.scriptName(call.scriptName)
        });
      },
      mode: 'fire-and-forget'
    }
  });
