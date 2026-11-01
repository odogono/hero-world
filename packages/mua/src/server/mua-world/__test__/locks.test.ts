import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURES = 'src/server/mua-world/__test__/fixtures';

/**
 * The same behaviour, built in (actions/locks.ts) and as a Script
 * (behaviours/lockable.talk): each must pass every case.
 */
describe.each([
  ['built in', `${FIXTURES}/locks.edl`],
  ['as a Script', `${FIXTURES}/locks-scripted.edl`]
])('Locks and keys, %s', (_name, FIXTURE) => {
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

  it("won't open while locked", async () => {
    expect(await send('open strongbox')).toBe('The strongbox is locked.');
    expect(await send('examine box')).toContain('It is closed and locked.');
  });

  it('unlocks with the key that fits, then opens', async () => {
    await send('take iron key');

    expect(await send('unlock box with iron key')).toBe(
      'You unlock the strongbox with the iron key.'
    );
    expect(await send('open box')).toBe(
      'Opening the strongbox reveals: the gold.'
    );
  });

  it('refuses a key that does not fit, or something that is not a key', async () => {
    await send('take tin key');
    await send('take spoon');

    expect(await send('unlock box with tin key')).toBe(
      "The tin key doesn't fit."
    );
    expect(await send('unlock box with spoon')).toBe(
      "You can't unlock anything with that."
    );
  });

  it('only uses a key you are carrying', async () => {
    expect(await send('unlock box with iron key')).toBe(
      "You aren't carrying any iron key."
    );
  });

  it('finds a fitting key you carry when none is named', async () => {
    await send('take tin key');
    await send('take iron key');

    expect(await send('unlock box')).toBe(
      '(with the iron key)\nYou unlock the strongbox with the iron key.'
    );
  });

  it('needs a key', async () => {
    expect(await send('unlock box')).toBe(
      'You need a key to unlock the strongbox.'
    );
  });

  it('locks again only once closed', async () => {
    await send('take iron key');
    await send('unlock box');
    await send('open box');

    expect(await send('lock box')).toBe(
      "You'll have to close the strongbox first."
    );
    await send('close box');
    // the strongbox's own message for locking
    expect(await send('lock box')).toBe(
      "(with the iron key)\nThe strongbox's bolts slide home."
    );
    expect(await send('lock box')).toBe('The strongbox is already locked.');
  });

  it('tells others in the room', async () => {
    const alice = await world.login('alice');
    alice.messages.length = 0;
    await send('take iron key');
    await send('unlock box');

    expect(alice.messages).toContain('bob unlocks the strongbox.');
  });
});
