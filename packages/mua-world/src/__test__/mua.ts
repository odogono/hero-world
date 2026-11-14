// A mua World started from one of mua_world's test fixtures, and players
// joined to it, for the Host's own tests
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DatabaseType } from 'odgn-ecs/db';
import { get } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { components, startMuaWorld, type MuaWorld } from '../index';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'packages/mua-scripts');
const FIXTURES = join(REPO, 'packages/mua_world/test/fixtures');

export const start = async (
  fixture: string,
  startingRoom = 'west_of_house',
  options: Partial<Parameters<typeof startMuaWorld>[1]> = {}
) => {
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
    startingRoom,
    ...options
  });
};

/**
 * A Character joined and in play, with every line it hears from now on,
 * and the `src` of every place's Picture it is shown
 */
export const join_ = async (mua: MuaWorld, name: string) => {
  const account = await mua.createAccount();
  const eid = await mua.createCharacter(account, name);
  await mua.enter(account, eid);
  const heard: string[] = [];
  const pictures: string[] = [];
  await mua.subscribe(eid, told =>
    typeof told === 'string'
      ? heard.push(told)
      : pictures.push(told.picture.src)
  );
  return { account, eid, heard, pictures };
};

export const where = (mua: MuaWorld, eid: number) =>
  get(mua.store, eid, 'location')?.in;
