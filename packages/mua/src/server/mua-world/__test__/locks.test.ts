import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/locks.edl';

describe('Locks and keys', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.send(bob, text);

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it("won't open while locked", () => {
    expect(send('open strongbox')).toBe('The strongbox is locked.');
    expect(send('examine box')).toContain('It is closed and locked.');
  });

  it('unlocks with the key that fits, then opens', () => {
    send('take iron key');

    expect(send('unlock box with iron key')).toBe(
      'You unlock the strongbox with the iron key.'
    );
    expect(send('open box')).toBe('Opening the strongbox reveals: the gold.');
  });

  it('refuses a key that does not fit, or something that is not a key', () => {
    send('take tin key');
    send('take spoon');

    expect(send('unlock box with tin key')).toBe("The tin key doesn't fit.");
    expect(send('unlock box with spoon')).toBe(
      "You can't unlock anything with that."
    );
  });

  it('only uses a key you are carrying', () => {
    expect(send('unlock box with iron key')).toBe(
      "You aren't carrying any iron key."
    );
  });

  it('finds a fitting key you carry when none is named', () => {
    send('take tin key');
    send('take iron key');

    expect(send('unlock box')).toBe(
      '(with the iron key)\nYou unlock the strongbox with the iron key.'
    );
  });

  it('needs a key', () => {
    expect(send('unlock box')).toBe('You need a key to unlock the strongbox.');
  });

  it('locks again only once closed', () => {
    send('take iron key');
    send('unlock box');
    send('open box');

    expect(send('lock box')).toBe("You'll have to close the strongbox first.");
    send('close box');
    expect(send('lock box')).toContain('You lock the strongbox');
    expect(send('lock box')).toBe('The strongbox is already locked.');
  });

  it('tells others in the room', async () => {
    const alice = await world.login('alice');
    alice.messages.length = 0;
    send('take iron key');
    send('unlock box');

    expect(alice.messages).toContain('bob unlocks the strongbox.');
  });
});
