// Asking a Service Script inside a Step, adapted from packages/mua_world/
// test/request_test.exs.
import { describe, expect, test } from 'bun:test';
import { createEngine, type Step } from 'ecs-engine';
import { createEcsTalk, toValue, type Outcome } from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { createEntity, get, put, query } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import type { Value } from '@northtalk/ts';

import { ask, replyOf } from '../host/request';

const mark = defineComponent({ id: 'mark', schema: { n: s.number() } });

// Each message marks the thing it is given, then replies as its name says
const PROBE = `on accept thing
  change thing, "mark", {n: 1}
  return "Done."
end accept

on refuse thing
  change thing, "mark", {n: 1}
  return {refused: "No."}
end refuse

on garble thing
  change thing, "mark", {n: 1}
  return {nonsense: 1}
end garble

on dawdle thing
  change thing, "mark", {n: 1}
  wait 2 s
  return "Late."
end dawdle

on crash thing
  change thing, "mark", {n: 1}
  repeat forever
  end repeat
end crash`;

const setup = async () => {
  const world = await createWorld([mark], { type: DatabaseType.BUN });
  const { store } = world;
  const talk = createEcsTalk(world, {});
  talk.putServiceScript('probe', PROBE, { limits: { fuelPerRun: 5000 } });
  const thing = createEntity(store);
  return { engine: createEngine(store, talk), store, thing };
};

const read = (v: Value) => v.asText();

/**
 * Asks the probe `message` about the thing in one Step, reading text as
 * accepted, and returns what `ask` did and every mark in the World after
 * the Step's commit
 */
const asking = async (
  message: string,
  before: (s: Step) => { error: unknown } | undefined = () => undefined
) => {
  const { engine, store, thing } = await setup();
  const result = await engine.step(s =>
    ask(s, () => {
      const failed = before(s);
      return (
        failed ?? {
          delivery: {
            args: [s.talk.handle(thing).value],
            message,
            to: { service: 'probe' }
          },
          read
        }
      );
    })
  );
  if (!result.ok) {
    throw result.error;
  }
  const marks = query(store, { with: ['mark'] }).map(e =>
    get(store, e, 'mark')
  );
  return { asked: result.output.result, marks };
};

describe('ask', () => {
  test('an accepted reply keeps what the Script did', async () => {
    expect(await asking('accept')).toEqual({
      asked: { kind: 'ok', result: 'Done.' },
      marks: [{ n: 1 }]
    });
  });

  test('a refusal undoes what the Script did', async () => {
    expect(await asking('refuse')).toEqual({
      asked: { kind: 'refused', message: 'No.' },
      marks: []
    });
  });

  test("a reply the asker can't read undoes it", async () => {
    const { asked, marks } = await asking('garble');
    expect(asked).toMatchObject({ kind: 'failed', why: { kind: 'malformed' } });
    expect(marks).toEqual([]);
  });

  test('a Run left waiting is abandoned, and undoes what it did', async () => {
    expect(await asking('dawdle')).toEqual({
      asked: { kind: 'failed', why: { kind: 'waiting' } },
      marks: []
    });
  });

  test('a Script that fails undoes what it did', async () => {
    const { asked, marks } = await asking('crash');
    expect(asked).toMatchObject({ kind: 'failed', why: { kind: 'failed' } });
    expect(marks).toEqual([]);
  });

  test('a setup that fails undoes what it did, and sends nothing', async () => {
    const { asked, marks } = await asking('accept', s => {
      put(s.store, createEntity(s.store), 'mark', { n: 2 });
      return { error: 'nope' };
    });
    expect(asked).toEqual({
      kind: 'failed',
      why: { error: 'nope', kind: 'setup' }
    });
    expect(marks).toEqual([]);
  });
});

const replied = (v: unknown): Outcome => ({
  kind: 'replied',
  value: toValue(v)
});

describe('replyOf', () => {
  test('a refusal says no with its text', () => {
    expect(replyOf(replied({ refused: 'Not now.' }))).toEqual({
      kind: 'refused',
      message: 'Not now.'
    });
  });

  test("a refusal that isn't text is malformed", () => {
    expect(replyOf(replied({ refused: 3 })).kind).toBe('malformed');
  });

  test("any other reply is the asker's to read", () => {
    for (const v of ['Done.', null, 3, { message: 'Placed.' }]) {
      expect(replyOf(replied(v))).toEqual({
        kind: 'replied',
        value: toValue(v)
      });
    }
  });

  test("a Run that didn't reply failed", () => {
    const outcomes: Outcome[] = [
      { kind: 'waiting' },
      { error: 'boom', kind: 'failed' },
      { kind: 'passed' }
    ];
    for (const o of outcomes) {
      expect(replyOf(o)).toEqual({ kind: 'failed', outcome: o });
    }
  });
});
