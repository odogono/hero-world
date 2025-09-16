import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';
import { createEntity, queryEntity } from '@entity';
import { createWorld, flush } from '@world';

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
    const e = createEntity(world, {
      statsProxyTest: { health: 100, level: 1, mana: 50 }
    });
    flush(world);

    const snap = queryEntity(world, { with: ['statsProxyTest'] });
    expect(snap).toBeDefined();

    // Assigning a new component on a snapshot should not persist
    (snap as any).locationProxyTest = { name: 'Forest', region: 'North' };
    flush(world);

    const shouldBeNull = queryEntity(world, {
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(shouldBeNull).toBeNull();
  });

  test('proxied: add/remove via assignment persists', async () => {
    const world = await createTestWorld();
    const e = createEntity(world, {
      statsProxyTest: { health: 100, level: 1, mana: 50 }
    });
    flush(world);

    // Opt in to proxied result
    const proxy = queryEntity(world, {
      asProxy: true,
      with: ['statsProxyTest']
    })!;
    (proxy as any).locationProxyTest = { name: 'Forest', region: 'North' };
    flush(world);

    const persisted = queryEntity(world, {
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(persisted).toBeDefined();
    expect(persisted!.locationProxyTest).toBeDefined();

    // Removing via null should also persist deletion
    (proxy as any).locationProxyTest = null;
    flush(world);

    const removed = queryEntity(world, {
      with: ['statsProxyTest', 'locationProxyTest']
    });
    expect(removed).toBeNull();
  });
});
