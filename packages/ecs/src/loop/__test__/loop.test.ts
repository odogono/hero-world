import { describe, expect, test } from 'bun:test';

import { createFrameLoop, type FrameSystem } from '..';
import { defineComponent, s } from '../../component';
import { DatabaseType } from '../../db';
import { eventComponent, runEvents, scheduleEvent } from '../../events';
import { createWorld } from '../../world';

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const counter = defineComponent({
  id: 'counter' as const,
  schema: { n: s.int() }
});

const createTestWorld = () =>
  createWorld([counter, eventComponent], { dbType });

type W = Awaited<ReturnType<typeof createTestWorld>>;

const stored = (world: W) =>
  (world.db.query('SELECT n FROM c_counter') as { n: number }[]).map(r => r.n);

const recorded = (world: W) =>
  (
    world.db.query('SELECT count(*) AS n FROM temp.ecs_changes') as {
      n: number;
    }[]
  )[0]!.n;

const increment: FrameSystem<W> = {
  name: 'increment',
  run: w => {
    for (const e of w.queryAll({ with: ['counter'] })) {
      e.counter.n += 1;
    }
  }
};

describe('createFrameLoop', () => {
  test('a Frame advances World time by frameMs', async () => {
    const world = await createTestWorld();
    const loop = createFrameLoop(world, [], { frameMs: 20 });
    loop.frame();
    loop.frame();
    expect(world.time).toBe(40);
  });

  test('a Frame commits what its systems changed', async () => {
    const world = await createTestWorld();
    world.create({ counter: { n: 0 } });
    world.flush();
    const loop = createFrameLoop(world, [increment]);
    loop.frame();
    loop.frame();
    expect(stored(world)).toEqual([2]);
  });

  test('a system sees what an earlier system changed in the same Frame', async () => {
    const world = await createTestWorld();
    world.create({ counter: { n: 0 } });
    world.flush();
    const seen: number[] = [];
    const read: FrameSystem<W> = {
      name: 'read',
      run: w => {
        seen.push(w.queryAll({ with: ['counter'] })[0]!.counter.n);
      }
    };
    createFrameLoop(world, [increment, read]).frame();
    expect(seen).toEqual([1]);
  });

  test('a system with `every` first runs one interval later, then once per interval', async () => {
    const world = await createTestWorld();
    const runs: number[] = [];
    const loop = createFrameLoop(
      world,
      [{ every: 30, name: 'slow', run: w => void runs.push(w.time) }],
      { frameMs: 10 }
    );
    for (let i = 0; i < 9; i++) {
      loop.frame();
    }
    expect(runs).toEqual([40, 70]);
  });

  test('recorded changes are discarded every discardEvery Frames by default', async () => {
    const world = await createTestWorld();
    world.create({ counter: { n: 0 } });
    world.flush();
    const loop = createFrameLoop(world, [increment], { discardEvery: 3 });
    loop.frame();
    expect(recorded(world)).toBe(1);
    loop.frame();
    loop.frame();
    expect(recorded(world)).toBe(0);
  });

  test("with changes: 'keep', recorded changes are left to take", async () => {
    const world = await createTestWorld();
    world.create({ counter: { n: 0 } });
    world.flush();
    const loop = createFrameLoop(world, [increment], {
      changes: 'keep',
      discardEvery: 1
    });
    loop.frame();
    loop.frame();
    expect(recorded(world)).toBe(1);
  });

  test('events run inside a Frame commit with it, and run once', async () => {
    const world = await createTestWorld();
    scheduleEvent(world, 'ping', {}, 10);
    world.flush();
    const ran: string[] = [];
    const events: FrameSystem<W> = {
      name: 'events',
      run: w => {
        // twice, as two systems might: the event must run only once
        runEvents(w, 'ping', ({ type }) => void ran.push(type), {
          flush: false
        });
        runEvents(w, 'ping', ({ type }) => void ran.push(type), {
          flush: false
        });
      }
    };
    createFrameLoop(world, [events], { frameMs: 10 }).frame();
    expect(ran).toEqual(['ping']);
    expect(world.queryAll({ with: ['event'] })).toHaveLength(0);
  });
});
