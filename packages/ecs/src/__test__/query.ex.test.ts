import { describe, expect, test } from 'bun:test';

import { DatabaseType } from '../db';
import { createWorld } from '../world';

const edl = `
def connected {
  connId: string
}

def authenticated {
  token: string optional
}

def withAdmin {
  rights: array
}

def watching {
  target: string
}

entity {
  connected { connId: '123' }
  authenticated { token: 'bearer 123' }
  withAdmin { rights: ['create'] }
  watching { target: 'mouse' }
}

entity {
  connected { connId: '456' }
  authenticated { token: 'bearer 456' }
  watching { target: 'cat' }
}

entity {
  connected { connId: '789' }
  authenticated { token: 'bearer 789' }
}


entity {
  connected { connId: '101' }
}
`;

describe('Query Extended', () => {
  test('should query', async () => {
    const world = await createWorld(edl, {
      path: ':memory:',
      type: DatabaseType.BUN
    });

    const entities = world.queryAll({ with: ['connected'] });
    expect(entities).toHaveLength(4);

    const connected = world.queryAll({
      with: ['connected'],
      without: ['authenticated']
    });
    expect(connected).toHaveLength(1);

    // querying with only returns that component
    const e123 = world.query({
      args: ['123'],
      where: 'connId = ?1',
      with: ['connected']
    });
    expect(e123).not.toBeNull();
    expect(e123?.connected.connId).toBe('123');

    const e123Ex = world.query({
      args: ['123'],
      maybe: ['authenticated', 'watching', 'withAdmin'],
      where: 'connId = ?1',
      with: ['connected']
    });

    expect(e123Ex?.watching?.target).toBe('mouse');
    expect(e123Ex?.authenticated?.token).toBe('bearer 123');
    expect(e123Ex?.withAdmin?.rights).toEqual(['create']);

    const e101Ex = world.query({
      args: ['101'],
      maybe: ['authenticated', 'watching', 'withAdmin'],
      where: 'connId = ?1',
      with: ['connected']
    });

    expect(e101Ex?.connected?.connId).toBe('101');
    expect(e101Ex?.authenticated).toBeUndefined();
    expect(e101Ex?.watching).toBeUndefined();
    expect(e101Ex?.withAdmin).toBeUndefined();

    // queryAll with maybe should include optional components only when present
    const all = world.queryAll({ maybe: ['watching'], with: ['connected'] });
    expect(all).toHaveLength(4);
    const watchingTargets = all
      .map(e => e.watching?.target)
      .filter(Boolean) as string[];
    expect(watchingTargets.sort()).toEqual(['cat', 'mouse']);

    // iterator with maybe
    using iter = world.queryIterator({
      maybe: ['authenticated'],
      with: ['connected']
    });
    const tokens: Array<string | undefined> = [];
    for (const e of iter) {
      tokens.push(e.authenticated?.token);
    }
    expect(tokens.filter(Boolean)).toHaveLength(3);
  });
});
