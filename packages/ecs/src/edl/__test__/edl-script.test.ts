import { describe, expect, it } from 'bun:test';

import { DatabaseType } from '../../db';
import { createWorld } from '../../world';
import { serializeEDL } from '../serialize';

const DEFS = `
def door {
  is_locked: boolean default false
}

def script {
  src: string not null
}
`;

const EDL = `
atom exit {
}

atom door: exit {
  door   { is_locked: true }
  script { src: "door.talk" }
}

entity front_door: door {
}

entity vault_door: door {
  script { src: "scripts/vault.talk" }
}
`;

const load = async (path?: string) => {
  const world = await createWorld(DEFS, {
    path: ':memory:',
    type: DatabaseType.BUN
  });
  world.executeEDL(EDL, { path });
  return world;
};

describe('EDL script component', () => {
  it('lists atoms and entities that declare their own script', async () => {
    const world = await load('/game/edl/main.edl');
    const vault = world
      .queryAll({ with: ['script'] })
      .find(e => e.script.src === 'scripts/vault.talk')!;

    expect(world.getScriptOwners()).toEqual([
      { kind: 'atom', name: 'door', src: '/game/edl/door.talk' },
      { eid: vault.id, kind: 'entity', src: '/game/edl/scripts/vault.talk' }
    ]);
  });

  it('inheritors share the atom script and keep the component', async () => {
    const world = await load();
    const scripted = world.queryAll({ with: ['script'] });
    expect(scripted.map(e => e.script.src).sort()).toEqual([
      'door.talk',
      'scripts/vault.talk'
    ]);
    // without a path, src is left as written
    expect(world.getScriptOwners().map(o => o.src)).toEqual([
      'door.talk',
      'scripts/vault.talk'
    ]);
  });

  it('round-trips through serializeEDL', async () => {
    const world = await load();
    const entities = world.queryAll({ with: ['script'] });
    const edl = serializeEDL({ entities });
    expect(edl).toContain('script { src: "scripts/vault.talk" }');

    const copy = await createWorld(DEFS, {
      path: ':memory:',
      type: DatabaseType.BUN
    });
    copy.executeEDL(edl);
    expect(
      copy
        .queryAll({ with: ['script'] })
        .map(e => e.script.src)
        .sort()
    ).toEqual(['door.talk', 'scripts/vault.talk']);
    expect(copy.getScriptOwners()).toHaveLength(2);
  });
});
