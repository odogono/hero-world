// A client's mirror of a Character's Perception (#164), over Bun's sqlite.
import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { get, query } from 'odgn-ecs/store';

import { openMirror, type MirrorSnapshot } from '../mirror';

const ROOM = 1;
const ADA = 2;
const LAMP = 3;
const CRATE = 4;
const COIN = 5;

const snapshot: MirrorSnapshot = {
  character: ADA,
  components: {
    container: [{ eid: CRATE, is_closed: true }],
    described: [
      { description: 'A room.', eid: ROOM, name: 'Room' },
      { description: 'A lamp.', eid: LAMP, name: 'Lamp' },
      { description: 'A crate.', eid: CRATE, name: 'Crate' }
    ],
    location: [
      { eid: ADA, in: ROOM },
      { eid: LAMP, in: ROOM },
      { eid: CRATE, in: ROOM }
    ],
    player: [{ eid: ADA, name: 'Ada' }]
  },
  place: ROOM
};

const open = async () => {
  const mirror = await openMirror({ path: ':memory:', type: DatabaseType.BUN });
  mirror.load(snapshot);
  return mirror;
};

const held = (mirror: Awaited<ReturnType<typeof open>>) =>
  query(mirror.store, {}).sort((a, b) => a - b);

describe('mirror', () => {
  test('holds a snapshot, with its own eids', async () => {
    const mirror = await open();
    expect(mirror.character).toBe(ADA);
    expect(mirror.place).toBe(ROOM);
    expect(held(mirror)).toEqual([ROOM, ADA, LAMP, CRATE]);
    expect(get(mirror.store, LAMP, 'location')).toEqual({ in: ROOM });
    expect(get(mirror.store, ADA, 'player')?.name).toBe('Ada');
  });

  test('applies a Step: something taken, a container opened', async () => {
    const mirror = await open();
    mirror.apply({
      gone: [],
      place: ROOM,
      put: {
        container: [{ eid: CRATE, is_closed: false }],
        described: [{ description: 'A coin.', eid: COIN, name: 'Coin' }],
        location: [
          { eid: LAMP, in: ADA },
          { eid: COIN, in: CRATE }
        ]
      },
      remove: {}
    });
    expect(get(mirror.store, LAMP, 'location')).toEqual({ in: ADA });
    expect(get(mirror.store, CRATE, 'container')?.is_closed).toBe(false);
    expect(get(mirror.store, COIN, 'described')?.name).toBe('Coin');
  });

  test('drops what left the Perception, and components removed', async () => {
    const mirror = await open();
    mirror.apply({
      gone: [LAMP],
      place: ROOM,
      put: {},
      remove: { container: [CRATE] }
    });
    expect(held(mirror)).toEqual([ROOM, ADA, CRATE]);
    expect(get(mirror.store, LAMP, 'described')).toBeUndefined();
    expect(get(mirror.store, CRATE, 'container')).toBeUndefined();
  });

  test('a fresh snapshot replaces it whole', async () => {
    const mirror = await open();
    mirror.load({
      character: ADA,
      components: { location: [{ eid: ADA, in: 9 }] },
      place: 9
    });
    expect(held(mirror)).toEqual([ADA]);
    expect(get(mirror.store, ROOM, 'described')).toBeUndefined();
    expect(mirror.place).toBe(9);
  });
});
