// Try it (#259): a builder's composition, tried out in a World built from
// the base EDL and their mirror, never the server's World.
import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get } from 'odgn-ecs/store';

import { worldFiles } from '../../scripts/files';
import { openLocalWorld } from '../local';
import type { MirrorSnapshot } from '../mirror';
import { openPreviewWorld, type TryIt } from '../preview';

const FILES = worldFiles();
const DATABASE = { path: ':memory:', type: DatabaseType.BUN } as const;

// as the server sends it: Ada in a room with Bob and an exit north,
// carrying a lamp
const MIRROR: MirrorSnapshot = {
  character: 11,
  components: {
    container: [{ eid: 10, is_closed: false }],
    described: [
      { description: 'A quiet hall.', eid: 10, name: 'Hall' },
      { description: 'A brass lamp.', eid: 12, name: 'Lamp' }
    ],
    item: [{ eid: 12, is_takeable: true }],
    location: [
      { eid: 11, in: 10 },
      { eid: 12, in: 11 },
      { eid: 13, in: 10 },
      { eid: 14, in: 10 }
    ],
    player: [
      { eid: 11, name: 'Ada' },
      { eid: 14, name: 'Bob' }
    ],
    portal: [{ dir: 'north', door: null, eid: 13 }]
  },
  place: 10
};

const SATCHEL: TryIt = {
  composition: {
    container: { capacity: 5, is_closed: true },
    described: { description: 'A leather satchel.', name: 'Satchel' },
    item: {}
  },
  mirror: MIRROR
};

const tryIt = (source: TryIt = SATCHEL) =>
  openPreviewWorld({
    clock: () => 0,
    database: DATABASE,
    files: FILES,
    source: { tryIt: source }
  });

type Preview = Awaited<ReturnType<typeof tryIt>>;

const originOf = (preview: Preview, kind: string) =>
  preview.origins()!.filter(([, o]) => o.kind === kind);

const composed = (preview: Preview) => originOf(preview, 'composition')[0]![0];

describe('Try it', () => {
  test('takes and opens a composed satchel, and its changes map back to the composition', async () => {
    const preview = await tryIt();
    expect(preview.runs()).toBe(true);
    const satchel = composed(preview);
    const [[standIn, origin]] = originOf(preview, 'stand-in') as [
      [number, unknown]
    ];
    expect(origin).toEqual({ eid: 11, kind: 'stand-in' });
    expect(preview.author).toBe(standIn);

    const taken = await preview.command('take satchel');
    expect(taken.lines).toContain('Taken.');
    expect(taken.outside).toEqual([]);
    expect(taken.changes).toContainEqual([
      satchel,
      'location',
      'changed',
      { in: standIn }
    ]);

    const opened = await preview.command('open satchel');
    expect(opened.lines).toContain('Opened.');
    expect(opened.changes).toContainEqual([
      satchel,
      'container',
      'changed',
      expect.objectContaining({ capacity: 5, is_closed: false })
    ]);
    preview.close();
  });

  test("puts the stand-in in the player's room with copies of what they carry", async () => {
    const preview = await tryIt();
    const perceived = new Map(
      originOf(preview, 'perceived').map(([eid, o]) => [
        (o as { eid: number }).eid,
        eid
      ])
    );
    const room = perceived.get(10)!;
    const lamp = perceived.get(12)!;
    expect(get(preview.store, preview.author!, 'location')).toEqual({
      in: room
    });
    expect(get(preview.store, lamp, 'location')).toEqual({
      in: preview.author
    });
    expect(get(preview.store, room, 'described')?.name).toBe('Hall');
    expect(get(preview.store, perceived.get(14)!, 'player')?.name).toBe('Bob');

    expect((await preview.command('inventory')).lines.join('\n')).toContain(
      'the lamp'
    );
    const dropped = await preview.command('drop lamp');
    expect(dropped.changes).toContainEqual([
      lamp,
      'location',
      'changed',
      { in: room }
    ]);
    preview.close();
  });

  test('says when a command reaches outside what the mirror holds', async () => {
    const preview = await tryIt();
    const moved = await preview.command('go north');
    expect(moved.ok).toBe(true);
    expect(moved.outside).toEqual([
      { eid: expect.any(Number), label: 'Beyond the north' }
    ]);
    const [beyond] = moved.outside!;
    expect(get(preview.store, preview.author!, 'location')).toEqual({
      in: beyond!.eid
    });
    preview.close();
  });

  test('reset rebuilds it from the same mirror and composition', async () => {
    const preview = await tryIt();
    const satchel = composed(preview);
    await preview.command('take satchel');
    await preview.command('open satchel');

    await preview.reset();
    expect(composed(preview)).toBe(satchel);
    expect(get(preview.store, satchel, 'location')).toEqual({
      in: get(preview.store, preview.author!, 'location')!.in
    });
    expect(get(preview.store, satchel, 'container')?.is_closed).toBe(true);
    preview.close();
  });

  test('refuses a component a builder may not compose', async () => {
    const scripted: TryIt = {
      composition: {
        ...SATCHEL.composition,
        script: { src: 'on take\nend take' }
      },
      mirror: MIRROR
    };
    await expect(tryIt(scripted)).rejects.toThrow(
      "A builder can't compose with script"
    );
  });

  test('an edited thing stands in place of its copy, where it is (#275)', async () => {
    // Ada edits the lamp she carries: no container, new words
    const preview = await tryIt({
      composition: {
        described: { description: 'A dented lamp.', name: 'Lamp' },
        readable: { text: 'Made in Hall.' }
      },
      mirror: MIRROR,
      replaces: 12
    });
    const lamp = composed(preview);
    expect(originOf(preview, 'composition')).toHaveLength(1);
    expect(
      originOf(preview, 'perceived').some(
        ([, o]) => (o as { eid: number }).eid === 12
      )
    ).toBe(false);
    expect(get(preview.store, lamp, 'location')).toEqual({
      in: preview.author
    });
    expect(get(preview.store, lamp, 'described')?.description).toBe(
      'A dented lamp.'
    );
    // a buildable component the edit took away is gone from the copy
    expect(get(preview.store, lamp, 'item')).toBeUndefined();
    const read = await preview.command('read lamp');
    expect(read.lines.join('\n')).toContain('Made in Hall.');
    preview.close();
  });

  test("an edited thing the mirror doesn't hold is made in the room", async () => {
    const preview = await tryIt({ ...SATCHEL, replaces: 99 });
    const satchel = composed(preview);
    expect(get(preview.store, satchel, 'location')).toEqual({
      in: get(preview.store, preview.author!, 'location')!.in
    });
    preview.close();
  });

  test('a Try it World is not migrated', async () => {
    const preview = await tryIt();
    expect(await preview.migrate('entity x {}')).toEqual({
      ok: false,
      reason: 'try_it'
    });
    preview.close();
  });
});

describe('Try it from a Local World (#291)', () => {
  test("opens from the Local World's own mirror of its Character", async () => {
    let character = -1;
    const local = await openLocalWorld({
      clock: () => 0,
      database: DATABASE,
      files: FILES,
      send: message => {
        if (message.event === 'joined') {
          character = message.character;
        }
      }
    });
    await local.receive({ name: 'Ada', type: 'join' });
    const account = get(local.world.store, character, 'player')
      ?.account as number;
    const mirror = await local.world.mirror(account, character);
    expect(mirror.character).toBe(character);

    const preview = await tryIt({ ...SATCHEL, mirror });
    expect(preview.runs()).toBe(true);
    const look = await preview.command('look');
    expect(look.lines.join('\n')).toContain('the crate');
    expect(look.lines.join('\n')).toContain('the satchel');
    local.close();
  });
});
