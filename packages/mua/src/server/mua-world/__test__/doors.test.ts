import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/doors.edl';

describe('Doors', () => {
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

  it('blocks the way while closed, and says so in the exits', () => {
    expect(send('look')).toContain('Exits: north (closed)');
    expect(send('north')).toBe('The oak door is closed.');
  });

  it('can be examined from the room', () => {
    expect(send('examine door')).toBe(
      'A heavy oak door.\nIt is closed and locked.'
    );
  });

  it('opens once unlocked, and lets you through', () => {
    expect(send('open door')).toBe('The oak door is locked.');
    send('take key');
    send('unlock door');

    expect(send('open door')).toBe('Opened.');
    expect(send('north')).toContain('Study');
  });

  it('is one door from both sides', async () => {
    const alice = await world.login('alice');
    send('take key');
    send('unlock door');
    send('open door');
    send('north');
    alice.messages.length = 0;

    // closed from the study, it is closed in the hall too
    expect(send('close door')).toBe('Closed.');
    expect(alice.messages).toContain('The oak door closes.');
    expect(send('south')).toBe('The oak door is closed.');
    expect(world.send(alice, 'north')).toBe('The oak door is closed.');

    // and locked from the study, it is locked in the hall
    send('lock door');
    expect(world.send(alice, 'open door')).toBe('The oak door is locked.');
  });

  it("can't be taken", () => {
    expect(send('take door')).toBe("You can't take that.");
  });
});
