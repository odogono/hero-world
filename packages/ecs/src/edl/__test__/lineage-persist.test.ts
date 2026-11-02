import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { defineComponent, s } from '../../component';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';

const statsComponent = defineComponent({
  id: 'stats' as const,
  schema: { hp: s.int() }
});

const scriptComponent = defineComponent({
  id: 'script' as const,
  schema: { src: s.string() }
});

const EDL = `
atom thing {
  stats { hp: 10 }
}

atom person : thing {
  script { src: "person.talk" }
}

entity hero : person {
  stats { hp: 20 }
}
`;

describe('Lineage in the database', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('keeps Lineage and Script owners when the world is opened again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ecs-lineage-'));
    const path = join(dir, 'world.db');
    const options = { path, type: DatabaseType.BUN };
    const defs = [statsComponent, scriptComponent];

    const first = await createWorld(defs, options);
    first.executeEDL(EDL, { path: join(dir, 'world.edl') });
    const hero = first.queryAll({ with: ['stats'] })[0]!.id;
    await first.close();

    // opened again without running the EDL
    const second = await createWorld(defs, options);

    expect(second.getEntityLineage(hero)).toEqual(['person']);
    expect(second.getAtomLineage('person')).toEqual(['thing']);
    expect(second.getAtomLineage('thing')).toEqual([]);
    expect(second.getScriptOwners()).toEqual([
      { kind: 'atom', name: 'person', src: join(dir, 'person.talk') }
    ]);
    expect(second.queryAll({ with: ['stats'] })[0]?.stats.hp).toBe(20);
    await second.close();
  });
});
