import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getEntity, getLocationOf } from '../queries/entity';
import { findRoomByMetaId } from '../queries/room';
import { MUA_TIMERS } from '../world/timers';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/timers.edl';

describe('World clock and timers', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  /** Runs the world on for some seconds of game time, a second a tick */
  const runFor = async (seconds: number) => {
    for (let ii = 0; ii < seconds; ii++) {
      await world.muaWorld.tick(1000);
    }
  };
  const heard = (text: string) => bob.messages.filter(m => m === text).length;

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('keeps world time on the system actor', async () => {
    await runFor(3);

    const { system } = world.muaWorld.places!;
    expect(world.muaWorld.clock!.now()).toBe(3000);
    expect(getEntity(world.muaWorld.world!, system, ['clock'])?.clock.now).toBe(
      3000
    );
  });

  it("sends a timer's message to the entity's Scripts when due", async () => {
    await runFor(9);
    expect(heard('The bell chimes.')).toBe(0);

    await runFor(2);
    expect(heard('The bell chimes.')).toBe(1);

    await runFor(10);
    expect(heard('The bell chimes.')).toBe(2);
  });

  it('resets a place on its reset timer', async () => {
    await world.sendAndWait(bob, 'take lamp');
    await world.sendAndWait(bob, 'east');
    await world.sendAndWait(bob, 'drop lamp');
    const lamp = world.muaWorld
      .world!.queryAll({ with: ['described', 'location'] })
      .find(e => e.described.name === 'Lamp')!.id;
    const belfry = findRoomByMetaId(world.muaWorld.world!, 'west_of_house')!;

    await runFor(62);

    expect(getLocationOf(world.muaWorld.world!, lamp)).toBe(belfry.id);
  });

  it("lets a Script's wait run on world time", async () => {
    await runFor(4);
    expect(heard('The candles flicker into life.')).toBe(0);

    await runFor(3);
    expect(heard('The candles flicker into life.')).toBe(1);
  });

  it("keeps its timers in ecs-talk's timer store", () => {
    const stored = world.muaWorld
      .world!.queryAll({ with: ['talkTimer'] })
      .map(t => t.talkTimer)
      .filter(t => t.script === MUA_TIMERS)
      .map(t => t.message)
      .toSorted();

    expect(stored).toEqual(['chime', 'reset']);
  });
});
