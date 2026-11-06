// What spec/ecs/changes can't say: putMany across several statements.
import { expect, test } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import {
  component,
  createEntity,
  define,
  deleteEntity,
  openStore,
  putMany,
  query
} from '../index';

const setup = async (n: number) => {
  const store = openStore(await createDatabase({ type: DatabaseType.BUN }));
  define(store, component('stats', [{ name: 'hp', type: 'int' }]));
  const ids = Array.from({ length: n }, () => createEntity(store));
  return { ids, store };
};

test('writes more rows than one statement holds', async () => {
  const { ids, store } = await setup(600);
  putMany(
    store,
    'stats',
    ids.map(eid => [eid, { hp: eid }] as const)
  );
  expect(query(store, { with: ['stats'] })).toHaveLength(600);
  store.db.close();
});

test('a bad row in a later statement undoes the earlier ones', async () => {
  const { ids, store } = await setup(600);
  deleteEntity(store, ids[500]!);
  expect(() =>
    putMany(
      store,
      'stats',
      ids.map(eid => [eid, { hp: 1 }] as const)
    )
  ).toThrow(`No entity ${ids[500]}.`);
  expect(query(store, { with: ['stats'] })).toHaveLength(0);
  store.db.close();
});
