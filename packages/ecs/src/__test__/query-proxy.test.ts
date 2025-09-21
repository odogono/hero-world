import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';
import { createWorld } from '@world';

const statsComponent = defineComponent({
  id: 'statsProxyTest',
  schema: {
    health: s.number(),
    level: s.number(),
    mana: s.number()
  }
});

const locationComponent = defineComponent({
  id: 'locationProxyTest',
  schema: {
    name: s.string(),
    region: s.string()
  }
});

const createTestWorld = async () =>
  await createWorld([statsComponent, locationComponent]);

describe('queryEntity proxied option', () => {
  test('default snapshot: add via assignment does not persist', async () => {
    const world = await createTestWorld();
    const e = world.create({
      statsProxyTest: { health: 100, level: 1, mana: 50 }
    });
    world.flush();

    const snap = world.query({ with: ['statsProxyTest'] });
    expect(snap).toBeDefined();

    // Assigning a new component on a snapshot should not persist
    snap!.locationProxyTest = { name: 'Forest', region: 'North' };
    world.flush();

    const shouldBeNull = world.query({
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(shouldBeNull).toBeNull();
  });

  test('proxied: add/remove via assignment persists', async () => {
    const world = await createTestWorld();
    const e = world.create({
      statsProxyTest: { health: 100, level: 1, mana: 50 }
    });
    world.flush();

    // Opt in to proxied result
    const proxy = world.query({
      asProxy: true,
      with: ['statsProxyTest']
    })!;
    proxy.locationProxyTest = { name: 'Forest', region: 'North' };
    world.flush();

    const persisted = world.query({
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(persisted).toBeDefined();
    expect(persisted!.locationProxyTest).toBeDefined();

    // Removing via null should also persist deletion
    proxy.locationProxyTest = null;
    world.flush();

    const removed = world.query({
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(removed).toBeNull();
  });
});
