import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '../../db';
import type { GenericEntity } from '../../types';
import { createWorld } from '../../world';
import { addComponent, addComponents } from '../add';
import { s } from '../builder';
import { defineComponent } from '../define';

const described = defineComponent({
  id: 'described' as const,
  schema: { description: s.string().optional(), name: s.string() }
});

const worldOpts = {
  clearExisting: true,
  dbType: (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN,
  path: ':memory:'
};

type World = Awaited<ReturnType<typeof makeWorld>>;
type Entity = GenericEntity<{
  described: { description?: string; name: string };
}>;

const makeWorld = () => createWorld([described], worldOpts);

const NEXT = { name: 'new' };

const ways: [string, (e: Entity) => void][] = [
  ['addComponents', e => addComponents(e, { described: NEXT })],
  ['addComponent', e => addComponent(e, 'described', NEXT)],
  [
    'assignment',
    e => {
      (e as Record<string, unknown>).described = NEXT;
    }
  ]
];

/** A world holding one entity whose `described` has been saved */
const saved = async () => {
  const world = await makeWorld();
  const entity = world.create();
  addComponent(entity, 'described', { description: 'old desc', name: 'old' });
  world.flush();
  return { id: entity.id, world };
};

const readBack = (world: World, id: number) => {
  world.entityCache.clear();
  return world.query({
    asProxy: false,
    entity: { id, world },
    maybe: ['described']
  }) as { described?: { description?: string | null; name: string } };
};

const rowCount = (world: World, id: number) =>
  (
    world.db.query(
      `SELECT COUNT(*) AS n FROM ${world.defs.get('described')!.tableName} WHERE eid = ?1`,
      [id]
    ) as { n: number }[]
  )[0]!.n;

describe('adding a component an entity already has', () => {
  for (const [label, add] of ways) {
    for (const cold of [false, true]) {
      test(`${label} replaces it whole${cold ? ' after the cache is cleared' : ''}`, async () => {
        const { id, world } = await saved();
        if (cold) {
          world.entityCache.clear();
        }
        const entity = world.query({
          entity: { id, world },
          maybe: ['described']
        }) as unknown as Entity;

        add(entity);
        world.flush();

        const read = readBack(world, id);
        expect(read.described?.name).toBe('new');
        expect(read.described?.description ?? null).toBeNull();
        expect(rowCount(world, id)).toBe(1);
      });
    }
  }

  test('replaces it on an entity that was never queried', async () => {
    const { id, world } = await saved();
    world.entityCache.clear();

    addComponents({ id, world } as unknown as Entity, { described: NEXT });
    world.flush();

    expect(readBack(world, id).described?.name).toBe('new');
    expect(rowCount(world, id)).toBe(1);
  });
});
