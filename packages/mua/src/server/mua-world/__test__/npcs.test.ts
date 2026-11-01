import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getLocationOf } from '../queries/entity';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/npcs.edl';

describe('NPCs', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.sendAndWait(bob, text);
  /** Runs the world on for some seconds of game time, a second a tick */
  const runFor = async (seconds: number) => {
    for (let ii = 0; ii < seconds; ii++) {
      await world.muaWorld.tick(1000);
    }
  };
  const idOf = (name: string) =>
    world.muaWorld
      .world!.queryAll({ with: ['described', 'location'] })
      .find(e => e.described.name === name)!.id;

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('shows the NPCs in a room', async () => {
    expect(await send('look')).toContain('Also here: Parrot, Cat');
  });

  it('lets an NPC react to speech with a command of its own', async () => {
    expect(await send('say pieces of eight')).toContain(
      'Parrot says, "pieces of eight"'
    );
  });

  it('can be spoken to', async () => {
    const output = await send('say to polly hello');

    expect(output).toContain('You say to Parrot, "hello"');
    expect(output).toContain('Parrot says, "hello"');
  });

  it('lets an NPC react to someone arriving', async () => {
    expect(await send('east')).toContain(
      'Trader says, "Welcome to the market!"'
    );
  });

  it('lets an NPC act on its own timer', async () => {
    const square = getLocationOf(world.muaWorld.world!, idOf('Cat'));
    // the cat's Script hears `start` in the first tick, and sets a timer
    // for ten seconds after that
    await runFor(9);
    expect(getLocationOf(world.muaWorld.world!, idOf('Cat'))).toBe(square);

    // its command runs the tick after the timer fires
    await runFor(3);
    expect(bob.messages).toContain('Cat goes east.');
    expect(getLocationOf(world.muaWorld.world!, idOf('Cat'))).not.toBe(square);
  });
});
