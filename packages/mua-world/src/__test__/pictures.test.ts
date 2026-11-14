// A place's Picture (ADR 0027), as mua_world's test/gameplay/pictures_test.exs
// has it: shown just before its description, and checked against the
// Pictures the World's files were bundled with
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { createWorld } from 'odgn-ecs/world';

import {
  components,
  pictureUrl,
  startMuaWorld,
  type PictureUrls
} from '../index';
import { join_ } from './mua';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'packages/mua-scripts');
const MAIN = join(REPO, 'packages/mua_world/priv/edl/main.edl');

const PICTURES: PictureUrls = {
  'pictures/boatyard.png': pictureUrl(
    'pictures/boatyard.png',
    'bbbbbbbbbbbbbbbb'
  ),
  'pictures/harbour_steps.png': pictureUrl(
    'pictures/harbour_steps.png',
    'aaaaaaaaaaaaaaaa'
  ),
  'pictures/headland.png': pictureUrl(
    'pictures/headland.png',
    'cccccccccccccccc'
  )
};

const start = async (pictures?: PictureUrls) => {
  const world = await createWorld(components, { type: DatabaseType.BUN });
  world.executeEDL(readFileSync(MAIN, 'utf8'), {
    path: MAIN,
    roots: { 'mua-scripts': SCRIPTS }
  });
  world.flush();
  return startMuaWorld(world, {
    clock: () => 0,
    pictures,
    readFile: file => readFileSync(file, 'utf8'),
    scriptsDir: SCRIPTS,
    startingRoom: 'harbour_steps'
  });
};

describe("a place's Picture", () => {
  test('comes just before its description, at the URL it was bundled with', async () => {
    const mua = await start(PICTURES);
    const bob = await join_(mua, 'bob');

    const [picture, look] = await mua.command(bob.account, bob.eid, 'look');
    expect(picture).toEqual({
      picture: {
        alt: expect.stringMatching(/^Worn granite steps/) as never,
        name: 'Harbour Steps',
        src: 'pictures/harbour_steps.png',
        url: '/pictures/harbour_steps.png?vsn=aaaaaaaaaaaa'
      }
    });
    expect(look).toStartWith('Harbour Steps\n');
  });

  test('is shown only to the Character the place is described to', async () => {
    const mua = await start(PICTURES);
    const ada = await join_(mua, 'ada');
    const bob = await join_(mua, 'bob');
    ada.pictures.length = 0;

    await mua.command(bob.account, bob.eid, 'look');
    expect(bob.pictures).toEqual(['pictures/harbour_steps.png']);
    expect(ada.pictures).toEqual([]);
  });

  test("stops a World starting when it isn't among the bundled Pictures", async () => {
    const { 'pictures/headland.png': _, ...missing } = PICTURES;
    await expect(start(missing)).rejects.toThrow(
      /Headland \(\d+\)'s picture pictures\/headland\.png has no file/
    );
  });

  test('is served at its path when no Pictures were bundled, as in a Preview World', async () => {
    const mua = await start();
    const bob = await join_(mua, 'bob');
    const [picture] = await mua.command(bob.account, bob.eid, 'look');
    expect(picture).toMatchObject({
      picture: { url: '/pictures/harbour_steps.png' }
    });
  });
});
