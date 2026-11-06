// What spec/ecs/steps can't say, adapted from odgn_ecs_engine's
// odgn_ecs_engine_test.exs and timers_test.exs.
import { describe, expect, test } from 'bun:test';
import { createEcsTalk, location, toValue } from 'ecs-talk';
import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import {
  armSystems,
  component,
  createEntity,
  define,
  deleteEntity,
  put,
  query
} from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { createEngine, instantUs, type Step } from '../engine';
import { ensureTables, storedWorldTime, takeWaiting } from '../tables';
import {
  dueTimers,
  removeTimer,
  scheduleTimer,
  timerCapability,
  timersOf,
  timersOwnedBy
} from '../timers';

const meta = defineComponent({
  id: 'meta',
  schema: { props: s.json().optional() }
});

const BELL = `on arm secs
  ask clock to now
  tell timer to schedule "bell", it + secs * 1 s, "ring", []
end arm

on disarm
  tell timer to cancel "bell"
end disarm

on ring
  show the target, "ding"
end ring

on slow
  wait 2 s
  return "done"
end slow`;

const setup = async () => {
  const world = await createWorld([location, meta], {
    type: DatabaseType.BUN
  });
  world.executeEDL(
    'atom bell {}\nentity tower: bell { meta { props: { id: "tower" } } }\nentity chapel: bell { meta { props: { id: "chapel" } } }'
  );
  world.flush();
  const { store } = world;
  ensureTables(store);
  const shown: [number, string][] = [];
  const talk = createEcsTalk(world, {
    capabilities: [timerCapability(store)],
    onShow: (eid, text) => shown.push([eid, text])
  });
  talk.loadAtomScript('bell', BELL);
  const names = world.getDefinitionNames();
  return {
    chapel: names.get('chapel')!,
    shown,
    store,
    talk,
    tower: names.get('tower')!
  };
};

describe('timers', () => {
  test('scopes timer names to the entity, though they share a Script', async () => {
    const { chapel, store, talk, tower } = await setup();
    const engine = createEngine(store, talk);
    await engine.step([
      { args: [toValue(5)], message: 'arm', to: tower },
      { args: [toValue(5)], message: 'arm', to: chapel }
    ]);
    expect(dueTimers(store, instantUs(5000)).length).toBe(2);
    expect(
      dueTimers(store, instantUs(5000))
        .map(t => t.owner)
        .sort()
    ).toEqual([tower, chapel].sort());
  });

  test('replaces a timer of the same name, and cancels one', async () => {
    const { store, talk, tower } = await setup();
    const engine = createEngine(store, talk);
    await engine.step([{ args: [toValue(5)], message: 'arm', to: tower }]);
    await engine.step([{ args: [toValue(9)], message: 'arm', to: tower }]);
    expect(timersOwnedBy(store, tower).map(t => t.at)).toEqual([
      instantUs(9000)
    ]);
    await engine.step([{ message: 'disarm', to: tower }]);
    expect(timersOwnedBy(store, tower)).toEqual([]);
  });

  test('goes with the entity it belongs to', async () => {
    const { store, talk, tower } = await setup();
    scheduleTimer(store, {
      at: 1,
      message: 'ring',
      name: 'x',
      owner: tower,
      script: 'host'
    });
    deleteEntity(store, tower);
    expect(timersOwnedBy(store, tower)).toEqual([]);
    expect(talk).toBeDefined();
  });

  test("gives the Host's own timers to its handler", async () => {
    const { store, talk, tower } = await setup();
    const ran: [string, number][] = [];
    const engine = createEngine(store, talk, {
      timers: {
        host: (step: Step, timer) => {
          removeTimer(step.store, timer);
          ran.push([timer.name, step.now]);
        }
      }
    });
    for (const [name, ms] of [
      ['late', 900],
      ['early', 800]
    ] as const) {
      scheduleTimer(store, {
        at: instantUs(ms),
        message: name,
        name,
        owner: tower,
        script: 'host'
      });
    }
    expect(engine.nextDeadline()).toBe(800);
    await engine.advance(1000);
    expect(ran).toEqual([
      ['early', 1000],
      ['late', 1000]
    ]);
    expect(timersOf(store, 'host')).toEqual([]);
    expect(storedWorldTime(store)).toBe(1000);
  });

  test("moves a World's talk_timer entities into the engine's table (ADR 0022)", async () => {
    const world = await createWorld([meta], { type: DatabaseType.BUN });
    const { store } = world;
    define(
      store,
      component('talk_timer', [
        { name: 'owner', onDelete: 'cascade', optional: false, type: 'eid' },
        { name: 'script', optional: false, type: 'string' },
        { name: 'name', optional: false, type: 'string' },
        { index: true, name: 'at', optional: false, type: 'int' },
        { name: 'message', optional: false, type: 'string' },
        { name: 'args', optional: false, type: 'string' }
      ])
    );
    const tower = createEntity(store);
    for (const [name, at] of [
      ['late', 9],
      ['early', 5]
    ] as const) {
      put(store, createEntity(store), 'talk_timer', {
        args: '[]',
        at,
        message: 'ring',
        name,
        owner: tower,
        script: 'x'
      });
    }
    ensureTables(store);
    // and again, as the next start does
    ensureTables(store);
    expect(timersOwnedBy(store, tower).map(t => [t.name, t.at])).toEqual([
      ['early', 5],
      ['late', 9]
    ]);
    expect(query(store, { with: ['talk_timer'] })).toEqual([]);
  });
});

describe('Waiting inputs', () => {
  test('a restart takes those left waiting', async () => {
    const { store, talk, tower } = await setup();
    const engine = createEngine(store, talk);
    const result = await engine.step(step =>
      step.ask(
        { asks: 'request', message: 'slow', to: tower },
        { actor: 7, input: 'x' },
        () => 'answered'
      )
    );
    expect(result.ok && result.output.result).toBe('waiting');
    expect(takeWaiting(store)).toEqual([{ actor: 7, input: 'x' }]);
    expect(takeWaiting(store)).toEqual([]);
  });

  test('a Service Script can only be asked', async () => {
    const { store, talk } = await setup();
    const engine = createEngine(store, talk);
    const result = await engine.step([
      { message: 'x', to: { service: 'nobody' } }
    ]);
    expect(result.ok).toBe(false);
  });
});

test('runs a System with the Step as its context', async () => {
  const { store, talk } = await setup();
  const seen: number[] = [];
  const chime = {
    every: 1000,
    name: 'chime',
    run: (_eids: unknown, step: Step) => {
      seen.push(step.now);
    }
  };
  const engine = createEngine(store, talk, { systems: [chime] });
  armSystems(store, [chime], 0);
  await engine.advance(1000);
  expect(seen).toEqual([1000]);
  expect(engine.nextDeadline()).toBe(2000);
});
