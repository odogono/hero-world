import { describe, expect, it } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import {
  component,
  createEntity,
  define,
  elements,
  openStore,
  put
} from '../index';

const setup = async () => {
  const db = await createDatabase({ type: DatabaseType.BUN });
  const store = openStore(db);
  define(store, component('location', [{ name: 'in', type: 'eid' }], true));
  define(store, component('described', [{ name: 'name', type: 'string' }]));
  define(store, component('held', [{ name: 'by', type: 'eid' }]));
  const room = createEntity(store);
  const lamp = createEntity(store);
  const box = createEntity(store);
  const elsewhere = createEntity(store);
  put(store, lamp, 'location', { in: room });
  put(store, lamp, 'described', { name: 'Lamp' });
  put(store, box, 'location', { in: room });
  put(store, elsewhere, 'location', { in: box });
  return { box, elsewhere, lamp, room, store };
};

describe('elements', () => {
  it('lists the entities located in a place, in id order', async () => {
    const { box, lamp, room, store } = await setup();

    expect(elements(store, room)).toEqual([lamp, box]);
  });

  it('narrows them with `with` and `where`', async () => {
    const { lamp, room, store } = await setup();

    expect(elements(store, room, { with: ['described'] })).toEqual([lamp]);
    expect(
      elements(store, room, { where: [['described', 'name', 'Lamp']] })
    ).toEqual([lamp]);
  });

  it('reads the named components with each', async () => {
    const { box, lamp, room, store } = await setup();

    expect(elements(store, room, { select: ['described'] })).toEqual([
      [lamp, { described: { name: 'Lamp' } }],
      [box, {}]
    ]);
  });

  it('reads a Location from another component', async () => {
    const { box, lamp, store } = await setup();
    put(store, box, 'held', { by: lamp });

    expect(elements(store, lamp, { location: ['held', 'by'] })).toEqual([box]);
  });

  it('is empty when the Location component is not defined', async () => {
    const { room, store } = await setup();

    expect(elements(store, room, { location: ['inside', 'of'] })).toEqual([]);
  });
});
