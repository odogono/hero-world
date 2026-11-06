// Adapted from packages/odgn_ecs_talk/test/elements_test.exs
import { describe, expect, test } from 'bun:test';
import { defineComponent, s } from 'odgn-ecs/component';
import { DatabaseType } from 'odgn-ecs/db';
import { createEntity, put } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { elements, location } from '../ecs-talk';

const mark = defineComponent({ id: 'mark', schema: { n: s.int().optional() } });

const setup = async () => {
  const world = await createWorld([location, mark], {
    type: DatabaseType.BUN
  });
  const { store } = world;
  const room = createEntity(store);
  const other = createEntity(store);
  const add = (place: number, n?: number) => {
    const eid = createEntity(store);
    put(store, eid, 'location', { in: place });
    if (n !== undefined) {
      put(store, eid, 'mark', { n });
    }
    return eid;
  };
  return { a: add(room, 1), b: add(room), c: add(other, 2), room, store };
};

describe('elements', () => {
  test('lists the entities in a place, in id order', async () => {
    const { a, b, room, store } = await setup();
    expect(elements(store, room)).toEqual([a, b]);
  });

  test('reads components with them, and narrows them', async () => {
    const { a, b, room, store } = await setup();
    expect(elements(store, room, { select: ['mark'] })).toEqual([
      [a, { mark: { n: 1 } }],
      [b, {}]
    ]);
    expect(elements(store, room, { with: ['mark'] })).toEqual([a]);
    expect(elements(store, room, { where: [['mark', 'n', '>', 0]] })).toEqual([
      a
    ]);
  });

  test("finds nothing when the Location component isn't defined", async () => {
    const { room, store } = await setup();
    expect(elements(store, room, { location: ['nowhere', 'in'] })).toEqual([]);
  });
});
