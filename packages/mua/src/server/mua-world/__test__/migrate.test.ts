import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DatabaseType } from 'odgn-ecs/db';
import { createWorld } from 'odgn-ecs/world';

import { defs } from '../coms';
import { findPlayerByName } from '../queries/player';
import { migrateWorld } from '../world/migrate';
import { MUA_TIMERS } from '../world/timers';
import { openTestWorld } from './helpers';

const BEFORE = 'src/server/mua-world/__test__/fixtures/timers.edl';
const AFTER = 'src/server/mua-world/__test__/fixtures/timers-changed.edl';

describe('Migrating a world kept in a file', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mua-migrate-'));
    dbPath = join(dir, 'world.db');
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** bob takes the lamp and walks to the hall, then the server stops */
  const playThenStop = async () => {
    const world = await openTestWorld(BEFORE, dbPath);
    const bob = await world.login('bob');
    await world.sendAndWait(bob, 'take lamp');
    await world.sendAndWait(bob, 'east');
    for (let ii = 0; ii < 5; ii++) {
      await world.muaWorld.tick(1000);
    }
    await world.muaWorld.close();
  };

  const migrate = async () => {
    const ecs = await createWorld(defs, {
      path: dbPath,
      type: DatabaseType.BUN
    });
    const result = migrateWorld(ecs, await Bun.file(AFTER).text(), {
      path: AFTER
    });
    await ecs.close();
    return result;
  };

  it('adds the new room and its exits, keeping players and time', async () => {
    await playThenStop();

    const { plan, timersCancelled } = await migrate();
    expect(plan.created).toEqual(['garden']);
    expect(timersCancelled.map(t => t.message)).toEqual(['chime']);

    const world = await openTestWorld(AFTER, dbPath);
    expect(world.muaWorld.clock!.now()).toBeGreaterThanOrEqual(5000);
    const bob = await world.login('bob');
    expect(await world.sendAndWait(bob, 'i')).toContain(
      'You are carrying: the lamp.'
    );
    expect(await world.sendAndWait(bob, 'look')).toContain('Hall');
    expect(await world.sendAndWait(bob, 'north')).toContain('Garden');
    expect(await world.sendAndWait(bob, 'south')).toContain('Hall');
    expect(await world.sendAndWait(bob, 'examine lamp')).toContain('dented');

    // only one bob, and the garden made once
    const ecs = world.muaWorld.world!;
    expect(findPlayerByName(ecs, 'bob')).not.toBeNull();
    expect(
      ecs
        .queryAll({ with: ['described'] })
        .filter(e => e.described.name === 'Garden')
    ).toHaveLength(1);
    // the chime is no longer stored
    expect(
      ecs
        .queryAll({ with: ['talkTimer'] })
        .filter(
          t => t.talkTimer.script === MUA_TIMERS && t.talkTimer.name === 'chime'
        )
    ).toHaveLength(0);
    await world.muaWorld.close();
  });

  it('changes nothing when the EDL is unchanged', async () => {
    await playThenStop();
    const ecs = await createWorld(defs, {
      path: dbPath,
      type: DatabaseType.BUN
    });
    const { plan, timersCancelled } = migrateWorld(
      ecs,
      await Bun.file(BEFORE).text(),
      { path: BEFORE }
    );
    await ecs.close();

    expect(plan.created).toEqual([]);
    expect(plan.updated).toEqual([]);
    expect(timersCancelled).toEqual([]);
  });
});
