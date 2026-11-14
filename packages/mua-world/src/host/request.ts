import type { Delivery, Step } from 'ecs-engine';
import { abandon, outcome, type Outcome, type Pending } from 'ecs-talk';

import type { Value } from '@northtalk/ts';

/**
 * Requests to Scripts: questions a Script answers with a reply, as
 * `MuaWorld.Request`.
 *
 * A Request says no by replying `{refused: text}`, and a Run that fails or
 * never replies says no too. What any other reply means is for whoever
 * asked to read.
 *
 * `ask` asks within a Step, all or nothing. Dispatch asks its own way
 * (`Step.ask`), since a command's Run may answer in a later Step, and
 * reads the reply with `replyOf`.
 */

/** What a Request's outcome says, before its asker reads it */
export type Reply =
  | { kind: 'failed'; outcome: Outcome }
  | { kind: 'malformed'; value: Value }
  | { kind: 'refused'; message: string }
  | { kind: 'replied'; value: Value };

/**
 * What a Request's outcome says: `refused` when the Script said no,
 * `malformed` when it meant to but its refusal isn't text, `failed` when
 * its Run didn't reply, and otherwise `replied` for the asker to read.
 */
export const replyOf = (o: Outcome): Reply => {
  if (o.kind !== 'replied') {
    return { kind: 'failed', outcome: o };
  }
  const v = o.value;
  if (v.kind === 'map' && v.hasKey('refused')) {
    const message = v.get('refused').asText();
    return message === undefined
      ? { kind: 'malformed', value: v }
      : { kind: 'refused', message };
  }
  return { kind: 'replied', value: v };
};

/**
 * Why a Request asked with `ask` didn't do what was asked: setup gave up,
 * its Run didn't reply (`waiting` or `failed`), or its reply couldn't be
 * read
 */
export type Failure =
  | Exclude<Outcome, { kind: 'replied' }>
  | { error: unknown; kind: 'setup' }
  | { kind: 'malformed'; value: Value };

export type Asked<T> =
  | { kind: 'failed'; why: Failure }
  | { kind: 'ok'; result: T }
  | { kind: 'refused'; message: string };

/**
 * What to ask, and how to read an accepted reply: the value it means, or
 * `undefined` for a reply it can't read. Made in setup, `read` can see
 * what setup made, such as a new entity. `{error}` gives up.
 */
export type Setup<T> =
  | { delivery: Delivery; read: (value: Value) => T | undefined }
  | { error: unknown };

const SAVEPOINT = 'mua_request';

/**
 * Asks a Request inside `s`, keeping what it changed only if the reply was
 * accepted. `setup` runs first, inside the same savepoint. A Run still
 * waiting is abandoned: nothing waits for its reply, but the Run carries
 * on, so what it changes once it wakes is kept (#321).
 *
 * Anything but `ok` leaves no change. The caller words what the player is
 * told.
 */
export const ask = async <T>(
  s: Step,
  setup: () => Setup<T>
): Promise<Asked<T>> => {
  const { db } = s.store;
  db.exec(`SAVEPOINT ${SAVEPOINT}`);
  let asked: Asked<T>;
  try {
    asked = await request(s, setup());
  } catch (error) {
    db.exec(`ROLLBACK TO ${SAVEPOINT}`);
    db.exec(`RELEASE ${SAVEPOINT}`);
    throw error;
  }
  if (asked.kind !== 'ok') {
    db.exec(`ROLLBACK TO ${SAVEPOINT}`);
  }
  db.exec(`RELEASE ${SAVEPOINT}`);
  return asked;
};

const request = async <T>(s: Step, set: Setup<T>): Promise<Asked<T>> => {
  if ('error' in set) {
    return { kind: 'failed', why: { error: set.error, kind: 'setup' } };
  }
  const pending = s.deliver({ ...set.delivery, asks: 'request' }) as Pending;
  s.pump();
  const o = await outcome(pending);
  if (o.kind === 'waiting') {
    abandon(pending);
  }
  const reply = replyOf(o);
  switch (reply.kind) {
    case 'replied': {
      const result = set.read(reply.value);
      return result === undefined
        ? { kind: 'failed', why: { kind: 'malformed', value: reply.value } }
        : { kind: 'ok', result };
    }
    case 'refused':
      return reply;
    case 'malformed':
      return { kind: 'failed', why: reply };
    case 'failed':
      return {
        kind: 'failed',
        why: reply.outcome as Exclude<Outcome, { kind: 'replied' }>
      };
  }
};
