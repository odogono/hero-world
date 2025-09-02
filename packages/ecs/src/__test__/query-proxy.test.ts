import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';
import { createEntity, queryEntity } from '@entity';
import type { ExtractBuilderComponents } from '@types';

import { createWorld, flush } from '../world';

const statsComponent = defineComponent({
  name: 'statsProxyTest',
  schema: {
    health: z.number(),
    level: z.number(),
    mana: z.number()
  }
});

const locationComponent = defineComponent({
  name: 'locationProxyTest',
  schema: {
    name: z.string(),
    region: z.string()
  }
});

const createTestWorld = async () =>
  (await createWorld()).registerComponent(statsComponent).registerComponent(locationComponent).build();

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
    const proxy = queryEntity(world, { with: ['statsProxyTest'], proxied: true })!;
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

