// The Host's own calls, which spec/mua/steps doesn't reach, adapted from
// packages/mua_world/test/gameplay/accounts_test.exs and lifecycle_test.exs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { createEntity, get, put } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { recordHomes } from '../host/lifecycle';
import { components, startMuaWorld, type MuaWorld } from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'packages/mua-scripts');
const FIXTURES = join(REPO, 'packages/mua_world/test/fixtures');

const start = async (fixture: string, startingRoom = 'west_of_house') => {
  const path = join(FIXTURES, fixture);
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(readFileSync(path, 'utf8'), {
    path,
    roots: { 'mua-scripts': SCRIPTS }
  });
  world.flush();
  return startMuaWorld(world, {
    clock: () => 0,
    readFile: file => readFileSync(file, 'utf8'),
    scriptsDir: SCRIPTS,
    startingRoom
  });
};

const join_ = async (mua: MuaWorld, name: string) => {
  const account = await mua.createAccount();
  const eid = await mua.createCharacter(account, name);
  await mua.enter(account, eid);
  const heard: string[] = [];
  await mua.subscribe(eid, line => heard.push(line));
  return { account, eid, heard };
};

const where = (mua: MuaWorld, eid: number) =>
  get(mua.store, eid, 'location')?.in;

describe('Accounts and Characters', () => {
  test('a new Character waits in Limbo until it enters', async () => {
    const mua = await start('lifecycle.edl');
    const account = await mua.createAccount();
    const bob = await mua.createCharacter(account, 'bob');
    expect(where(mua, bob)).toBe(mua.places.limbo);
    expect(mua.command(account, bob, 'look')).rejects.toThrow('not_in_play');
    expect(await mua.enter(account, bob)).toEqual([
      "Welcome, bob! Type 'look' to begin, or 'help' for the commands."
    ]);
    expect(where(mua, bob)).toBe(mua.places.startingRoom);
    // one already in play carries on without a fresh greeting
    expect(await mua.enter(account, bob)).toEqual([]);
  });

  test('refuses a Character it can not make, or one it does not own', async () => {
    const mua = await start('lifecycle.edl');
    const account = await mua.createAccount();
    await mua.createCharacter(account, 'Bob');
    expect(mua.createCharacter(account, 'bob')).rejects.toThrow('name_taken');
    expect(mua.createCharacter(account, '9lives')).rejects.toThrow(
      'invalid_name'
    );
    expect(mua.createCharacter(999_999, 'ann')).rejects.toThrow(
      'not_an_account'
    );
    const other = await mua.createAccount();
    const [bob] = await mua.characters(account);
    expect(mua.command(other, bob!.id, 'look')).rejects.toThrow('not_owner');
  });

  test('a Character that leaves returns to the room it left', async () => {
    const mua = await start('lifecycle.edl');
    const bob = await join_(mua, 'bob');
    const ann = await join_(mua, 'ann');
    await mua.command(bob.account, bob.eid, 'east');
    const hall = where(mua, bob.eid);
    await mua.leave(bob.account, bob.eid);
    expect(where(mua, bob.eid)).toBe(mua.places.limbo);
    expect(await mua.characters(bob.account)).toEqual([
      { id: bob.eid, inPlay: false, name: 'bob' }
    ]);
    await mua.enter(bob.account, bob.eid);
    expect(where(mua, bob.eid)).toBe(hall);
    expect(ann.heard).toContain('bob goes east.');
  });
});

describe('lifecycle', () => {
  test('gives each thing its starting place as its home', async () => {
    const mua = await start('lifecycle.edl');
    const shrine = (await mua.named('west_of_house'))!;
    const lamp = (await mua.named('lamp'))!;
    expect(get(mua.store, lamp, 'home')).toEqual({ in: shrine });
  });

  test('gives a placed thing no home, and takes away one it had (#271)', async () => {
    const mua = await start('lifecycle.edl');
    const shrine = (await mua.named('west_of_house'))!;
    const account = await mua.createAccount();
    const satchel = createEntity(mua.store);
    put(mua.store, satchel, 'location', { in: shrine });
    put(mua.store, satchel, 'made_by', { account });
    const pouch = createEntity(mua.store);
    put(mua.store, pouch, 'location', { in: shrine });
    put(mua.store, pouch, 'made_by', { account });
    put(mua.store, pouch, 'home', { in: shrine });
    recordHomes(mua.store);
    expect(get(mua.store, satchel, 'home')).toBeUndefined();
    expect(get(mua.store, pouch, 'home')).toBeUndefined();
  });

  test('puts strayed things back when a place resets, and tells its Scripts', async () => {
    const mua = await start('lifecycle.edl');
    const bob = await join_(mua, 'bob');
    const shrine = (await mua.named('west_of_house'))!;
    const lamp = (await mua.named('lamp'))!;
    for (const line of ['take lamp', 'east', 'drop lamp', 'west']) {
      await mua.command(bob.account, bob.eid, line);
    }
    bob.heard.length = 0;
    expect(await mua.reset(shrine)).toBe(1);
    expect(where(mua, lamp)).toBe(shrine);
    expect(bob.heard).toContain('Dust settles over the shrine.');
  });

  test('leaves what a Character carries when a place resets', async () => {
    const mua = await start('lifecycle.edl');
    const bob = await join_(mua, 'bob');
    await mua.command(bob.account, bob.eid, 'take lamp');
    await mua.command(bob.account, bob.eid, 'east');
    expect(await mua.reset((await mua.named('west_of_house'))!)).toBe(0);
  });

  test('tells Scripts the World has started', async () => {
    const mua = await start('lifecycle.edl');
    const idol = (await mua.named('idol'))!;
    expect(get(mua.store, idol, 'item')?.weight).toBe(7);
  });
});
