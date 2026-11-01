import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getLocationOf } from '../queries/entity';
import { findPlayerByName } from '../queries/player';
import { MUA_TIMERS } from '../world/timers';
import { openTestWorld } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/timers.edl';

describe('A world kept in a file', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mua-world-'));
    dbPath = join(dir, 'world.db');
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** Plays a little, then closes the world as a server shutting down would */
  const playThenStop = async () => {
    const world = await openTestWorld(FIXTURE, dbPath);
    const bob = await world.login('bob');
    await world.sendAndWait(bob, 'take lamp');
    await world.sendAndWait(bob, 'east');
    for (let ii = 0; ii < 5; ii++) {
      await world.muaWorld.tick(1000);
    }
    await world.muaWorld.close();
  };

  it('keeps players, things and time across a restart', async () => {
    await playThenStop();

    const world = await openTestWorld(FIXTURE, dbPath);
    const ecs = world.muaWorld.world!;
    const bobId = findPlayerByName(ecs, 'bob')!.id;

    // bob waits in Limbo until he logs in again, then is back in the hall
    expect(getLocationOf(ecs, bobId)).toBe(world.muaWorld.places!.limbo);
    const bob = await world.login('bob');
    expect(await world.sendAndWait(bob, 'look')).toContain('Hall');
    expect(await world.sendAndWait(bob, 'i')).toBe(
      'You are carrying: the lamp.'
    );

    // world time carried on
    expect(world.muaWorld.clock!.now()).toBeGreaterThanOrEqual(5000);
    await world.muaWorld.close();
  });

  it("doesn't build the world from its EDL again", async () => {
    await playThenStop();

    const world = await openTestWorld(FIXTURE, dbPath);
    const lamps = world.muaWorld
      .world!.queryAll({ with: ['described'] })
      .filter(e => e.described.name === 'Lamp');

    expect(lamps).toHaveLength(1);
    await world.muaWorld.close();
  });

  it('keeps its timers and Scripts working', async () => {
    await playThenStop();

    const world = await openTestWorld(FIXTURE, dbPath);
    const ecs = world.muaWorld.world!;
    const stored = ecs
      .queryAll({ with: ['talkTimer'] })
      .filter(t => t.talkTimer.script === MUA_TIMERS);
    expect(stored.map(t => t.talkTimer.message).toSorted()).toEqual([
      'chime',
      'reset'
    ]);

    // the belfry's Script still chimes, on the timer it had before
    const bob = await world.login('bob');
    await world.sendAndWait(bob, 'west');
    bob.messages.length = 0;
    for (let ii = 0; ii < 10; ii++) {
      await world.muaWorld.tick(1000);
    }
    expect(bob.messages).toContain('The bell chimes.');
    await world.muaWorld.close();
  });
});
