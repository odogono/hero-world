import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/scripts.edl';

describe('Scripts', () => {
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

  it("answers with the thing's Script", async () => {
    expect(await send('examine statue')).toBe('The statue winks at you.');
  });

  it('falls through to the built-in action when the Script passes', async () => {
    expect(await send('take statue')).toBe('Taken.');
    expect(await send('i')).toBe('You are carrying: the statue.');
  });

  it('uses the built-in action for things without a Script', async () => {
    expect(await send('examine rock')).toBe('A plain rock.');
  });

  it("lets the room's Script refuse a command", async () => {
    expect(await send('north')).toBe('A guard blocks your way.');
    expect(await send('look')).toContain('Guardroom');
  });

  it('lets a Script react and still pass the command on', async () => {
    const alice = await world.login('alice');
    alice.messages.length = 0;

    const output = await send('say hello');

    expect(output).toContain('You say, "hello"');
    expect(alice.messages).toContain('bob says, "hello"');
    expect(alice.messages).toContain('The guard grunts.');
  });

  it('reports a Script that fails', async () => {
    expect(await send('examine tablet')).toBe('Something went wrong.');
  });
});
