import { describe, expect, it } from 'bun:test';

import { DatabaseType, createDatabase } from '../../db';
import { component, define, fromJSON, openStore, toJSON } from '../index';

describe('definitions', () => {
  it('keeps whether a component is buildable, for a store opened on it', async () => {
    const db = await createDatabase({ type: DatabaseType.BUN });
    const store = openStore(db);
    const item = component(
      'item',
      [{ name: 'weight', type: 'float' }],
      false,
      true
    );
    define(store, item);
    expect(store.components.get('item')?.buildable).toBe(true);

    // another store on the same database reads it back
    expect(openStore(db).components.get('item')?.buildable).toBe(true);

    define(store, { ...item, buildable: false });
    expect(openStore(db).components.get('item')?.buildable).toBe(false);
  });

  it('reads a definition stored before buildable as not buildable', () => {
    const c = fromJSON('door', '{"columns":[],"play_state":true}');
    expect(c.playState).toBe(true);
    expect(c.buildable).toBe(false);
  });

  it('stores the same text as odgn_ecs, keys sorted', () => {
    expect(toJSON(component('door', [], true, true))).toBe(
      '{"buildable":true,"columns":[],"play_state":true}'
    );
  });
});
