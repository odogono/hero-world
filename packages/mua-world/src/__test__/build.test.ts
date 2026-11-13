// Building through the Host's calls: placing, editing, storing and
// destroying a placed thing, adapted from packages/mua_world/test/gameplay/
// build_test.exs, edit_test.exs, store_test.exs and destroy_test.exs.
// Whether each may be done is the build Service Script's.
import { describe, expect, test } from 'bun:test';
import { exists, get, put, query } from 'odgn-ecs/store';

import { MuaWorldError, type MuaWorld } from '../index';
import { join_, start, where } from './mua';

const SATCHEL = {
  container: { capacity: 5, is_closed: true },
  described: { description: 'A leather satchel.', name: 'Satchel' },
  item: {}
};

type Player = Awaited<ReturnType<typeof join_>>;

const grant = (
  mua: MuaWorld,
  p: Player,
  builder: Record<string, unknown> = {}
) => put(mua.store, p.account, 'builder', builder);

const place = (mua: MuaWorld, p: Player, composition: unknown = SATCHEL) =>
  mua.place(p.account, p.eid, composition);

/** The World's refusal, as a `MuaWorldError`'s code */
const refusal = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if (error instanceof MuaWorldError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('expected a refusal');
};

const named = (mua: MuaWorld, name: string) =>
  query(mua.store, { where: [['described', 'name', name]] })[0];

const setup = async () => {
  const mua = await start('locks.edl');
  const ada = await join_(mua, 'ada');
  const bob = await join_(mua, 'bob');
  return { ada, bob, mua };
};

const withPlaced = async () => {
  const { ada, bob, mua } = await setup();
  grant(mua, ada);
  const { eid: satchel } = await place(mua, ada);
  return { ada, bob, mua, satchel };
};

const withOpened = async () => {
  const { ada, bob, mua } = await setup();
  grant(mua, ada);
  const { eid: satchel } = await place(mua, ada);
  const editingChanged: string[] = [];
  await mua.subscribe(ada.eid, () => undefined, {
    onEditing: () => editingChanged.push('ada')
  });
  await mua.command(ada.account, ada.eid, 'edit satchel');
  return { ada, bob, editingChanged, mua, satchel };
};

describe('placing a composed thing (#258)', () => {
  test('a builder places a thing in their room, which another player takes and opens', async () => {
    const { ada, bob, mua } = await setup();
    grant(mua, ada);
    const offered: [string, string[] | undefined][] = [];
    await mua.subscribe(ada.eid, (text, suggestions) =>
      offered.push([text, suggestions])
    );

    const placed = await place(mua, ada);
    expect(placed).toEqual({
      eid: expect.any(Number),
      maxPlaced: 50,
      placed: 1
    });
    expect(ada.heard).toContain('You make the satchel.');
    expect(bob.heard).toContain('ada makes the satchel.');
    // the line offers its Maker a way back to it (#275, #292)
    expect(offered).toEqual([['You make the satchel.', ['edit the satchel']]]);
    expect(where(mua, placed.eid)).toBe(where(mua, ada.eid));
    expect(get(mua.store, placed.eid, 'made_by')).toEqual({
      account: ada.account
    });
    expect(await mua.builder(ada.account)).toEqual({
      maxCapacity: 20,
      maxPlaced: 50,
      placed: 1
    });

    expect(await mua.command(bob.account, bob.eid, 'take satchel')).toEqual([
      'Taken.'
    ]);
    expect(await mua.command(bob.account, bob.eid, 'open satchel')).toEqual([
      'Opened.'
    ]);
  });

  test('an Account without builder, or over its quota, is refused, and nothing is written', async () => {
    const { ada, mua } = await setup();
    expect(await mua.builder(ada.account)).toBeNull();
    expect(await refusal(place(mua, ada))).toBe("You can't build.");
    expect(named(mua, 'Satchel')).toBeUndefined();

    grant(mua, ada, { max_placed: 1 });
    await place(mua, ada);
    const pouch = {
      ...SATCHEL,
      described: { ...SATCHEL.described, name: 'Pouch' }
    };
    expect(await refusal(place(mua, ada, pouch))).toBe(
      'You have placed all 1 things you may.'
    );
    expect(named(mua, 'Pouch')).toBeUndefined();
    expect((await mua.builder(ada.account))?.placed).toBe(1);
  });

  test('an invalid composition is refused, and nothing is written', async () => {
    const { ada, mua } = await setup();
    grant(mua, ada);
    const heard = ada.heard.length;

    const refusals: [unknown, string][] = [
      [
        { ...SATCHEL, script: { src: 'on take\nend take' } },
        "You can't build with script"
      ],
      [
        { ...SATCHEL, location: { in: ada.eid } },
        "You can't build with location"
      ],
      [{ container: SATCHEL.container, item: {} }, 'A thing needs a described'],
      [{ ...SATCHEL, container: { capacity: 21 } }, 'can hold at most 20'],
      [{ ...SATCHEL, item: { weight: 'heavy' } }, 'must be float'],
      [{ ...SATCHEL, item: { colour: 'red' } }, "no property 'colour'"],
      ['satchel', 'A composition is a map']
    ];
    for (const [composition, reason] of refusals) {
      expect(await refusal(place(mua, ada, composition))).toContain(reason);
    }

    expect(named(mua, 'Satchel')).toBeUndefined();
    expect((await mua.builder(ada.account))?.placed).toBe(0);
    expect(ada.heard.length).toBe(heard);
  });

  test("only the Character's own Account places, and only in play", async () => {
    const { ada, bob, mua } = await setup();
    grant(mua, ada);
    expect(await refusal(mua.place(bob.account, ada.eid, SATCHEL))).toBe(
      'not_owner'
    );
    await mua.leave(ada.account, ada.eid);
    expect(await refusal(place(mua, ada))).toBe('not_in_play');
  });
});

describe('editing a placed thing (#274)', () => {
  test('a builder edits what they placed, and others see it change', async () => {
    const { ada, bob, mua, satchel } = await withPlaced();
    expect(await mua.editing(ada.account, ada.eid)).toBeNull();
    await mua.command(ada.account, ada.eid, 'edit satchel');

    const opened = await mua.editing(ada.account, ada.eid);
    expect(opened?.eid).toBe(satchel);
    expect(Object.keys(opened!.composition).sort()).toEqual([
      'container',
      'described',
      'item'
    ]);
    expect(opened?.composition.described?.description).toBe(
      'A leather satchel.'
    );

    expect(
      await mua.edit(ada.account, ada.eid, satchel, {
        put: {
          container: { capacity: 8 },
          described: { description: 'A battered satchel.' }
        }
      })
    ).toEqual({ eid: satchel });
    expect(ada.heard.at(-1)).toBe('You reshape the satchel.');
    expect(bob.heard.at(-1)).toBe('ada reshapes the satchel.');
    expect(get(mua.store, satchel, 'described')).toEqual({
      description: 'A battered satchel.',
      name: 'Satchel'
    });
    expect(get(mua.store, satchel, 'container')?.capacity).toBe(8);
    // saving closes it
    expect(await mua.editing(ada.account, ada.eid)).toBeNull();
  });

  test('an edit adds and removes components', async () => {
    const { ada, mua, satchel } = await withPlaced();
    await mua.command(ada.account, ada.eid, 'edit satchel');
    await mua.edit(ada.account, ada.eid, satchel, {
      put: { readable: { text: 'Property of ada.' } },
      remove: ['container']
    });
    expect(get(mua.store, satchel, 'container')).toBeUndefined();
    expect(get(mua.store, satchel, 'readable')).toEqual({
      text: 'Property of ada.'
    });
  });

  test('an edit must be opened, permitted and within reach; a refused one writes nothing', async () => {
    const { ada, bob, mua, satchel } = await withPlaced();
    const patch = { put: { described: { name: 'Pouch' } } };
    grant(mua, bob);
    expect(await refusal(mua.edit(bob.account, bob.eid, satchel, patch))).toBe(
      'Open it with edit first.'
    );

    await mua.command(ada.account, ada.eid, 'edit satchel');
    expect(
      await refusal(
        mua.edit(ada.account, ada.eid, satchel, {
          put: { item: { weight: 'heavy' } }
        })
      )
    ).toContain('must be float');
    grant(mua, ada, { edit: 'none' });
    expect(await refusal(mua.edit(ada.account, ada.eid, satchel, patch))).toBe(
      "You can't edit things."
    );
    expect(get(mua.store, satchel, 'described')?.name).toBe('Satchel');
    // still open
    expect((await mua.editing(ada.account, ada.eid))?.eid).toBe(satchel);

    grant(mua, ada);
    put(mua.store, satchel, 'location', {
      in: (await mua.named('strongbox'))!
    });
    expect(await refusal(mua.edit(ada.account, ada.eid, satchel, patch))).toBe(
      "You can't reach that from here."
    );

    await mua.stopEditing(ada.account, ada.eid);
    expect(await mua.editing(ada.account, ada.eid)).toBeNull();
  });
});

describe('storing and destroying from the composer (#284)', () => {
  test('storing puts the open thing in Limbo, still counted, and closes it', async () => {
    const { ada, bob, editingChanged, mua, satchel } = await withOpened();
    expect(editingChanged).toEqual(['ada']);

    expect(await mua.putAway(ada.account, ada.eid, satchel, 'store')).toEqual({
      eid: satchel,
      maxPlaced: 50,
      placed: 1
    });
    expect(ada.heard.at(-1)).toBe('You put away the satchel.');
    expect(bob.heard.at(-1)).toBe('ada puts away the satchel.');
    expect(where(mua, satchel)).toBe(mua.places.limbo);
    expect(await mua.editing(ada.account, ada.eid)).toBeNull();
    expect(editingChanged).toEqual(['ada', 'ada']);
  });

  test('destroying unmakes the open thing and frees its place in the quota', async () => {
    const { ada, mua, satchel } = await withOpened();
    grant(mua, ada, { max_placed: 1 });
    expect(await mua.putAway(ada.account, ada.eid, satchel, 'destroy')).toEqual(
      {
        eid: satchel,
        maxPlaced: 1,
        placed: 0
      }
    );
    expect(ada.heard.at(-1)).toBe('You unmake the satchel.');
    expect(exists(mua.store, satchel)).toBe(false);
    expect(await mua.editing(ada.account, ada.eid)).toBeNull();
  });

  test('a refused one writes nothing, and the thing stays open', async () => {
    const { ada, mua, satchel } = await withOpened();
    put(mua.store, (await mua.named('spoon'))!, 'location', { in: satchel });
    expect(
      await refusal(mua.putAway(ada.account, ada.eid, satchel, 'destroy'))
    ).toBe('The satchel holds things: empty it first.');
    grant(mua, ada, { store: 'none' });
    expect(
      await refusal(mua.putAway(ada.account, ada.eid, satchel, 'store'))
    ).toBe("You can't store things.");
    expect(where(mua, satchel)).toBe(where(mua, ada.eid));
    expect((await mua.editing(ada.account, ada.eid))?.eid).toBe(satchel);
  });
});
