import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '../component';
import { createWorld } from '../world';

const statsComponent = defineComponent({
  id: 'statsPendingTest',
  schema: {
    health: s.number(),
    mana: s.number()
  }
});

const setup = async () => {
  const world = await createWorld([statsComponent]);
  const { id } = world.create({ statsPendingTest: { health: 100, mana: 50 } });
  world.flush();
  const read = () =>
    world.query({ entity: { id, world }, with: ['statsPendingTest'] })!
      .statsPendingTest!;
  const proxy = () =>
    world.query({
      asProxy: true,
      entity: { id, world },
      with: ['statsPendingTest']
    })!;
  return { proxy, read, world };
};

describe('querying an entity with unsaved changes', () => {
  test('keeps the change when the entity is queried again before flush', async () => {
    const { proxy, read, world } = await setup();

    proxy().statsPendingTest!.health = 75;
    read();
    world.flush();

    expect(read().health).toBe(75);
  });

  test('a later query sees the unsaved change', async () => {
    const { proxy, read } = await setup();

    proxy().statsPendingTest!.health = 75;

    expect(read().health).toBe(75);
  });

  test('changes through two copies of the entity are both saved', async () => {
    const { proxy, read, world } = await setup();

    const first = proxy();
    const second = proxy();
    first.statsPendingTest!.health = 75;
    second.statsPendingTest!.mana = 10;
    world.flush();

    expect(read()).toEqual({ health: 75, mana: 10 });
  });

  test('after a flush, queries read fresh data again', async () => {
    const { proxy, read, world } = await setup();

    proxy().statsPendingTest!.health = 75;
    world.flush();
    proxy().statsPendingTest!.health = 60;
    world.flush();

    expect(read().health).toBe(60);
  });
});

describe('replacing a whole component', () => {
  test('replaces unsaved field changes, and all copies see it', async () => {
    const { proxy, read, world } = await setup();

    const first = proxy();
    first.statsPendingTest!.health = 75;
    const second = proxy();
    second.statsPendingTest = { health: 1, mana: 2 };

    expect(first.statsPendingTest!.health).toBe(1);
    world.flush();
    expect(read()).toEqual({ health: 1, mana: 2 });
  });
});

/** n entities, health 0 … n-1, flushed */
const many = async (n: number) => {
  const world = await createWorld([statsComponent]);
  const ids = Array.from(
    { length: n },
    (_, i) => world.create({ statsPendingTest: { health: i, mana: 0 } }).id
  );
  world.flush();
  const healths = (opts: { limit?: number; offset?: number } = {}) =>
    world
      .queryAll({ ...opts, with: ['statsPendingTest'] })
      .map(e => e.statsPendingTest.health);
  return { healths, ids, world };
};

describe('querying after a delete that is not yet flushed (#231)', () => {
  test('the deleted entity is gone from queryAll, query and queryIterator', async () => {
    const { healths, ids, world } = await many(3);
    world.delete({ id: ids[0]! });
    expect(healths()).toEqual([1, 2]);
    expect(
      world.query({
        entity: { id: ids[0]!, world },
        with: ['statsPendingTest']
      })
    ).toBeNull();
    using it = world.queryIterator({ with: ['statsPendingTest'] });
    expect([...it].map(e => e.statsPendingTest.health)).toEqual([1, 2]);
  });

  test('limit and offset count only entities still in the World', async () => {
    const { healths, ids, world } = await many(5);
    world.delete({ id: ids[0]! });
    world.delete({ id: ids[2]! });
    expect(healths({ limit: 2 })).toEqual([1, 3]);
    expect(healths({ limit: 2, offset: 1 })).toEqual([3, 4]);
    expect(
      world.query({ with: ['statsPendingTest'] })!.statsPendingTest.health
    ).toBe(1);
  });

  test('get returns null for it', async () => {
    const { ids, world } = await many(1);
    world.delete({ id: ids[0]! });
    expect(world.get(ids[0]!)).toBeNull();
  });

  test('it stays gone after the flush', async () => {
    const { healths, ids, world } = await many(2);
    world.delete({ id: ids[0]! });
    world.flush();
    expect(healths()).toEqual([1]);
  });

  test('a discarded Change Scope brings it back', async () => {
    const { healths, ids, world } = await many(2);
    const scope = world.openChanges();
    scope.run(() => world.delete({ id: ids[0]! }));
    expect(healths()).toEqual([1]);
    scope.discard();
    expect(healths()).toEqual([0, 1]);
    expect(world.get(ids[0]!)).not.toBeNull();
  });
});
