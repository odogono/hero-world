// What spec/ecs/systems can't say: the context a System runs with, and
// what its run returns.
import { expect, test } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import {
  component,
  createEntity,
  define,
  openStore,
  put,
  runSystem,
  type System
} from '../index';

test('runs with a context, and returns what its run returns', async () => {
  const store = openStore(await createDatabase({ type: DatabaseType.BUN }));
  define(store, component('npc', [{ name: 'active', type: 'boolean' }]));
  const a = createEntity(store);
  put(store, a, 'npc', { active: true });

  const heartbeat: System<string, [unknown, string]> = {
    every: 45,
    name: 'heartbeat',
    query: { with: ['npc'] },
    run: (entities, context) => [entities, context]
  };
  expect(runSystem(store, heartbeat, 0, 'ctx')).toEqual([[a], 'ctx']);
  store.db.close();
});
