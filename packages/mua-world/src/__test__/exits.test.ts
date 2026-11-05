import { describe, expect, it } from 'bun:test';
import { get, query } from 'odgn-ecs/store';

import { expand, find } from '../exits';
import { buildWorld } from './world';

const ROOMS = `
entity hall { exits { north: $study down: { to: $cellar one_way: true } } }
entity study { exits { up: { msg: "The ceiling is too high." } } }
entity cellar {}
`;

describe('Exits.expand', () => {
  it('makes each exit a room declares, and the way back', async () => {
    const { id, store } = await buildWorld(ROOMS);
    expand(store);

    const north = find(store, id('hall'), 'north')!;
    const back = find(store, id('study'), 'south')!;
    expect(get(store, north, 'portal')).toMatchObject({ to: id('study') });
    expect(get(store, back, 'portal')).toMatchObject({ to: id('hall') });
    expect(get(store, find(store, id('study'), 'up')!, 'portal')).toMatchObject(
      { msg: 'The ceiling is too high.', to: null }
    );
  });

  it('makes no way back from a one-way exit', async () => {
    const { id, store } = await buildWorld(ROOMS);
    expand(store);

    expect(find(store, id('hall'), 'down')).not.toBeNull();
    expect(find(store, id('cellar'), 'up')).toBeNull();
  });

  it('makes nothing new when expanded again', async () => {
    const { store } = await buildWorld(ROOMS);
    const made = expand(store);

    expect(made).toHaveLength(4);
    expect(expand(store)).toEqual([]);
    expect(query(store, { with: ['portal'] })).toHaveLength(4);
  });

  it("keeps a room's own exit over another room's way back", async () => {
    const { id, store } = await buildWorld(`
      entity hall { exits { north: $study } }
      entity study { exits { south: $cellar } }
      entity cellar {}
    `);
    expand(store);

    const south = find(store, id('study'), 'south')!;
    expect(get(store, south, 'portal')).toMatchObject({ to: id('cellar') });
  });
});
