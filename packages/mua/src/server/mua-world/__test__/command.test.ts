import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/command.edl';

describe('A Script reading its command', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.sendAndWait(bob, text);

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('sees the second object of the command', async () => {
    await send('take feather');

    expect(await send('unlock box with feather')).toBe(
      'You press the Feather into a gap between the panels.'
    );
  });

  it('sees when there is no second object', async () => {
    expect(await send('unlock box')).toBe('There is no keyhole you can see.');
  });

  it('tells everyone else in the room, but not the actor', async () => {
    const alice = await world.login('alice');
    alice.messages.length = 0;
    await send('take feather');

    const output = await send('unlock box with feather');

    expect(alice.messages).toContain('bob fiddles with the puzzle box.');
    expect(output).not.toContain('fiddles');
  });
});
