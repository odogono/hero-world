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
