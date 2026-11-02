import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { EDLError, isEDLChanged, migrateEDL } from '..';
import { defineComponent, s } from '../../component';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';
import { edlRecord } from '../record';

const described = defineComponent({
  id: 'described' as const,
  schema: { description: s.string().optional(), name: s.string() }
});
const exits = defineComponent({
  id: 'exits' as const,
  schema: { to: s.json() }
});
const readable = defineComponent({
  id: 'readable' as const,
  schema: { text: s.string() }
});
const door = defineComponent({
  id: 'door' as const,
  playState: true,
  schema: { isOpen: s.boolean().default(false) }
});
const location = defineComponent({
  id: 'location' as const,
  playState: true,
  schema: { in: s.int() }
});
const script = defineComponent({
  id: 'script' as const,
  schema: { src: s.string() }
});

const defs = [described, exits, readable, door, location, script];

const BEFORE = `
atom room {
  described { name: "Room" }
}
atom portal {}

entity hall : room {
  described { name: "Hall" }
  exits { to: { north: $yard } }
}
entity yard : room {
  described { name: "Yard" }
}
entity gate : portal {
  described { name: "Gate" }
  door { is_open: false }
  location { in: $hall }
}
entity sign {
  described { name: "Sign" }
  readable { text: "Keep out" }
  location { in: $yard }
}
entity old_bench {
  described { name: "Bench" }
}
`;

// a garden is added north of the yard, the hall is renamed, the sign
// loses its text, the gate gets a new base, and the bench is gone
const AFTER = `
atom room {
  described { name: "Room" }
}
atom portal {}
atom heavy {}

entity hall : room {
  described { name: "Great hall" }
  exits { to: { north: $yard } }
}
entity yard : room {
  described { name: "Yard" }
  exits { to: { north: $garden } }
}
entity gate : portal heavy {
  described { name: "Gate" }
  door { is_open: false }
  location { in: $yard }
}
entity sign {
  described { name: "Sign" }
  location { in: $yard }
}
entity garden : room {
  described { name: "Garden" }
  exits { to: { south: $yard } }
}
`;

/** Lamp and key both starting in `room` */
const moved = (room: string) => `
entity hall {
  described { name: "Hall" }
}
entity yard {
  described { name: "Yard" }
}
entity lamp {
  described { name: "Lamp" }
  location { in: $${room} }
}
entity key {
  described { name: "Key" }
  location { in: $${room} }
}
`;

const open = (path = ':memory:') =>
  createWorld(defs, { path, type: DatabaseType.BUN });

type Defs = Awaited<ReturnType<typeof open>>;
/** An entity's components, read back plainly */
type Read = Record<string, Record<string, unknown> | undefined> & {
  id: number;
};

const named = (world: Defs, name: string) => {
  const eid = world.getDefinitionNames().get(name);
  expect(eid).toBeDefined();
  return world.query({
    asProxy: false,
    entity: { id: eid!, world },
    maybe: defs.map(d => d.id)
  })! as unknown as Read;
};

/** A world built from BEFORE, then played: the gate opened, a player made */
const played = async (path = ':memory:') => {
  const world = await open(path);
  world.executeEDL(BEFORE);
  const gate = world.query({
    entity: { id: world.getDefinitionNames().get('gate')!, world },
    with: ['door']
  })!;
  gate.door!.isOpen = true;
  const player = world.create({
    described: { name: 'Pat' },
    location: { in: world.getDefinitionNames().get('hall')! }
  });
  world.flush();
  return { player: player.id, world };
};

describe('migrateEDL', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
      dir = undefined;
    }
  });

  it('records Definition names and the EDL hash when the EDL first runs', async () => {
    const { world } = await played();
    expect([...world.getDefinitionNames().keys()].sort()).toEqual([
      'gate',
      'hall',
      'old_bench',
      'sign',
      'yard'
    ]);
    expect(isEDLChanged(world, BEFORE)).toBe(false);
    expect(isEDLChanged(world, AFTER)).toBe(true);
  });

  it('plans the changes on a dry run without making them', async () => {
    const { world } = await played();
    const entityCount = () =>
      (
        world.db.query('SELECT COUNT(*) AS n FROM tbl_entity') as {
          n: number;
        }[]
      )[0]!.n;
    const before = entityCount();

    const plan = migrateEDL(world, AFTER, { dryRun: true });

    expect(plan.created).toEqual(['garden']);
    expect(plan.gone.map(g => g.name)).toEqual(['old_bench']);
    expect(plan.atoms.added).toEqual(['heavy']);
    const byName = Object.fromEntries(plan.updated.map(u => [u.name, u]));
    expect(byName.hall?.changed).toEqual(['described']);
    expect(byName.yard?.added).toEqual(['exits']);
    expect(byName.sign?.removed).toEqual(['readable']);
    expect(byName.gate?.lineage).toEqual({
      from: ['portal'],
      to: ['portal', 'heavy']
    });
    // the gate never moved in play, so the EDL moves it; play opened it,
    // so its door is kept and reported
    expect(byName.gate?.changed).toEqual(['location']);
    expect(plan.kept).toEqual([
      { components: ['door'], eid: byName.gate!.eid, name: 'gate' }
    ]);

    expect(entityCount()).toBe(before);
    expect(named(world, 'hall').described?.name).toBe('Hall');
    expect(isEDLChanged(world, AFTER)).toBe(true);
  });

  it('drops a field the EDL no longer gives, leaving one row', async () => {
    const world = await open();
    world.executeEDL(`
entity hall {
  described { name: "Hall" description: "Big" }
}
`);
    world.flush();

    migrateEDL(
      world,
      `
entity hall {
  described { name: "Great hall" }
}
`
    );

    const hall = named(world, 'hall');
    expect(hall.described?.name).toBe('Great hall');
    expect(hall.described?.description ?? null).toBeNull();
    const rows = world.db.query(
      `SELECT COUNT(*) AS n FROM ${world.defs.get('described')!.tableName} WHERE eid = ?1`,
      [hall.id]
    ) as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });

  it('brings the world up to date and keeps players and Play state', async () => {
    const { player, world } = await played();

    migrateEDL(world, AFTER);

    const garden = world.getDefinitionNames().get('garden')!;
    const yard = world.getDefinitionNames().get('yard')!;
    expect(named(world, 'garden').described?.name).toBe('Garden');
    expect(named(world, 'garden').exits?.to).toEqual({ south: yard });
    expect(named(world, 'yard').exits?.to).toEqual({ north: garden });
    expect(named(world, 'hall').described?.name).toBe('Great hall');
    expect(named(world, 'sign').readable).toBeUndefined();

    // the gate keeps what play did to it, and goes where the EDL now says
    const gate = named(world, 'gate');
    expect(gate.door?.isOpen).toBe(true);
    expect(gate.location?.in).toBe(yard);
    expect(world.getEntityLineage(gate.id)).toEqual(['portal', 'heavy']);
    expect(world.getAtomLineage('heavy')).toEqual([]);

    // the bench is only reported; the player is untouched
    expect(named(world, 'old_bench').described?.name).toBe('Bench');
    const pat = world.query({
      asProxy: false,
      entity: { id: player, world },
      with: ['described', 'location']
    })!;
    expect(pat.described?.name).toBe('Pat');

    expect(isEDLChanged(world, AFTER)).toBe(false);
    expect(migrateEDL(world, AFTER).updated).toEqual([]);
  });

  it('sets Play state play never changed, and keeps what it did (#77)', async () => {
    const world = await open();
    world.executeEDL(`
entity hall {
  described { name: "Hall" }
}
entity yard {
  described { name: "Yard" }
}
entity lamp {
  described { name: "Lamp" }
  location { in: $hall }
}
entity key {
  described { name: "Key" }
  location { in: $hall }
}
`);
    const ids = world.getDefinitionNames();
    // a player carries the key off to the yard
    const key = world.query({
      entity: { id: ids.get('key')!, world },
      with: ['location']
    })!;
    key.location!.in = ids.get('yard')!;
    world.flush();

    // both now start in the yard, then later in the hall again
    const plan = migrateEDL(world, moved('yard'));
    expect(plan.updated.map(u => [u.name, u.changed])).toEqual([
      ['lamp', ['location']]
    ]);
    expect(plan.kept).toEqual([]);
    expect(named(world, 'lamp').location?.in).toBe(ids.get('yard'));

    // the key now matches the EDL, so it moves with the next edit
    const again = migrateEDL(world, moved('hall'));
    expect(again.updated.map(u => u.name).sort()).toEqual(['key', 'lamp']);
    expect(named(world, 'key').location?.in).toBe(ids.get('hall'));
  });

  it('keeps Play state when the world never saved what the EDL set', async () => {
    const { world } = await played();
    world.db.exec('DELETE FROM tbl_edl_value');

    const plan = migrateEDL(world, AFTER, { dryRun: true });

    // static components still take the EDL's value
    expect(plan.updated.find(u => u.name === 'hall')?.changed).toEqual([
      'described'
    ]);
    const gate = plan.updated.find(u => u.name === 'gate');
    expect(gate?.changed).toEqual([]);
    expect(plan.kept).toEqual([
      { components: ['door', 'location'], eid: gate!.eid, name: 'gate' }
    ]);
  });

  it('renames an entity the EDL says it was, keeping it and its state (#78)', async () => {
    const { world } = await played();
    const gate = world.getDefinitionNames().get('gate')!;
    const renamed = BEFORE.replace(
      'entity gate : portal',
      'entity yard_gate was gate : portal'
    );

    const dry = migrateEDL(world, renamed, { dryRun: true });
    expect(dry.renamed).toEqual([{ eid: gate, from: 'gate', to: 'yard_gate' }]);
    expect(dry.created).toEqual([]);
    expect(dry.gone).toEqual([]);
    expect(world.getDefinitionNames().get('gate')).toBe(gate);

    migrateEDL(world, renamed);
    const names = world.getDefinitionNames();
    expect(names.has('gate')).toBe(false);
    expect(names.get('yard_gate')).toBe(gate);
    expect(named(world, 'yard_gate').door?.isOpen).toBe(true);

    // once migrated, the marker changes nothing and can be dropped
    const dropped = renamed.replace(' was gate', '');
    expect(migrateEDL(world, dropped).renamed).toEqual([]);
    expect(world.getDefinitionNames().get('yard_gate')).toBe(gate);
  });

  it('refuses a rename from a name the EDL still defines', async () => {
    const { world } = await played();
    const edl = `${BEFORE}\nentity yard_gate was gate {}\n`;
    expect(() => migrateEDL(world, edl, { dryRun: true })).toThrow(
      "'yard_gate' was 'gate'"
    );
  });

  it('takes entities gone from the EDL out of play with prune', async () => {
    const { world } = await played();
    const bench = world.getDefinitionNames().get('old_bench')!;
    const pruned: number[] = [];

    const plan = migrateEDL(world, AFTER, { prune: eid => pruned.push(eid) });

    expect(pruned).toEqual([bench]);
    expect(plan.pruned).toBe(true);
    expect(world.getDefinitionNames().has('old_bench')).toBe(false);
  });

  it('does not bring back an entity deleted in play', async () => {
    const { world } = await played();
    world.delete({ id: world.getDefinitionNames().get('sign')! });
    world.flush();

    const plan = migrateEDL(world, AFTER);

    expect(plan.missing.map(m => m.name)).toEqual(['sign']);
    expect(plan.created).toEqual(['garden']);
  });

  it('migrates a world reopened from its file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ecs-migrate-'));
    const path = join(dir, 'world.db');
    const first = await played(path);
    await first.world.close();

    const world = await open(path);
    expect(isEDLChanged(world, AFTER)).toBe(true);
    migrateEDL(world, AFTER);
    await world.close();

    const reopened = await open(path);
    expect(named(reopened, 'garden').described?.name).toBe('Garden');
    expect(named(reopened, 'gate').door?.isOpen).toBe(true);
    expect(isEDLChanged(reopened, AFTER)).toBe(false);
    await reopened.close();
  });
});

/** What a world records and holds for each entity the EDL names */
const snapshot = (world: Defs, names: string[]) => {
  const ids = world.getDefinitionNames();
  const nameOf = new Map([...ids].map(([name, eid]) => [eid, name]));
  const record = edlRecord(world);
  // references hold ids, which differ between the worlds
  const byName = (v: unknown) => nameOf.get(v as number) ?? v;
  /** A component with the ids it refers to replaced by Definition names */
  const withNames = (component: string, data: Record<string, unknown>) => {
    if (component === 'location') {
      return { ...data, in: byName(data.in) };
    }
    if (component === 'exits') {
      const to = data.to as Record<string, unknown>;
      return {
        to: Object.fromEntries(
          Object.entries(to).map(([dir, v]) => [dir, byName(v)])
        )
      };
    }
    return data;
  };
  return {
    atoms: ['room', 'portal', 'heavy'].map(a => world.getAtomLineage(a)),
    entities: names.map(name => {
      const entity = named(world, name);
      const id = entity.id;
      const components = Object.fromEntries(
        defs.map(({ id: c }) => [c, entity[c] && withNames(c, entity[c])])
      );
      const edlValues = Object.fromEntries(
        [...record.getEDLValues(id)].map(([c, value]) => [
          c,
          withNames(c, JSON.parse(value) as Record<string, unknown>)
        ])
      );
      return {
        components,
        edlValues,
        lineage: world.getEntityLineage(id),
        name
      };
    }),
    scripts: world
      .getScriptOwners()
      .map(o => (o.kind === 'atom' ? o.name : nameOf.get(o.eid)))
  };
};

describe('a Build is a Migration from an empty world', () => {
  it('plans nothing when migrating to the EDL it was built from', async () => {
    const world = await open();
    world.executeEDL(BEFORE);
    const plan = migrateEDL(world, BEFORE);
    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(plan.kept).toEqual([]);
    expect(plan.gone).toEqual([]);
    expect(plan.atoms).toEqual({ added: [], changed: [], removed: [] });
  });

  it('leaves an unplayed world as building the new EDL would', async () => {
    const migrated = await open();
    migrated.executeEDL(BEFORE);
    migrateEDL(migrated, AFTER);
    const built = await open();
    built.executeEDL(AFTER);

    const names = ['hall', 'yard', 'gate', 'sign', 'garden'];
    expect(snapshot(migrated, names)).toEqual(snapshot(built, names));
  });

  it('refuses to build a world twice', async () => {
    const world = await open();
    world.executeEDL(BEFORE);
    expect(() => world.executeEDL(AFTER)).toThrow(EDLError);
    expect(() => world.executeEDL(AFTER)).toThrow(/migrateEDL/);
  });
});

/** The hall's name as the EDL sets it */
const hallAs = (name: string) => `
entity hall {
  described { name: "${name}" }
}
entity yard {
  described { name: "Yard" }
}
`;

/** A world built with the hall named "Hall", then the hall renamed live */
const editedLive = async () => {
  const world = await open();
  world.executeEDL(hallAs('Hall'));
  const hall = world.query({
    entity: { id: world.getDefinitionNames().get('hall')!, world },
    with: ['described']
  })!;
  hall.described!.name = 'Entrance';
  world.flush();
  return world;
};

describe('a Migration keeps components edited live (#90)', () => {
  it('records the EDL value of every component, static and Play state', async () => {
    const world = await open();
    world.executeEDL(BEFORE);
    const gate = world.getDefinitionNames().get('gate')!;
    expect([...edlRecord(world).getEDLValues(gate).keys()].sort()).toEqual([
      'described',
      'door',
      'location'
    ]);
  });

  it('keeps a static component changed after Build, and lists it in kept', async () => {
    const world = await editedLive();
    const hall = world.getDefinitionNames().get('hall')!;

    const plan = migrateEDL(world, hallAs('Great hall'));

    expect(named(world, 'hall').described?.name).toBe('Entrance');
    expect(plan.kept).toEqual([
      { components: ['described'], eid: hall, name: 'hall' }
    ]);
    expect(plan.updated).toEqual([]);
  });

  it('sets a static component left alone to the EDL’s new value', async () => {
    const world = await editedLive();

    const plan = migrateEDL(
      world,
      hallAs('Great hall').replace('"Yard"', '"Courtyard"')
    );

    expect(named(world, 'yard').described?.name).toBe('Courtyard');
    expect(plan.updated.map(u => [u.name, u.changed])).toEqual([
      ['yard', ['described']]
    ]);
  });

  it('keeps a live edit through later Migrations until it matches the EDL', async () => {
    const world = await editedLive();
    migrateEDL(world, hallAs('Great hall'));

    expect(migrateEDL(world, hallAs('Grand hall')).kept).toHaveLength(1);
    expect(named(world, 'hall').described?.name).toBe('Entrance');

    // the EDL adopts the edit, so the hall follows the EDL again
    expect(migrateEDL(world, hallAs('Entrance')).kept).toEqual([]);
    migrateEDL(world, hallAs('Front hall'));
    expect(named(world, 'hall').described?.name).toBe('Front hall');
  });

  it('removes a static component the EDL stops setting, but not Play state', async () => {
    const world = await open();
    world.executeEDL(BEFORE);

    const plan = migrateEDL(
      world,
      BEFORE.replace('readable { text: "Keep out" }', '').replace(
        'location { in: $yard }',
        ''
      )
    );

    const sign = named(world, 'sign');
    expect(sign.readable).toBeUndefined();
    expect(sign.location?.in).toBe(world.getDefinitionNames().get('yard'));
    expect(plan.updated.map(u => [u.name, u.removed])).toEqual([
      ['sign', ['readable']]
    ]);
  });
});
