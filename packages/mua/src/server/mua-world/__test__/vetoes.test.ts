import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/vetoes.edl';

describe('Vetoes', () => {
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

  it("lets the room being left veto with a Script's reply", async () => {
    expect(await send('north')).toBe('The sentry steps in front of you.');
    expect(await send('look')).toContain('Gatehouse');
  });

  it('lets the move happen when the Script passes', async () => {
    expect(await send('east')).toContain('Hall');
  });

  it('lets the room being entered veto with a fixed response', async () => {
    expect(await send('south')).toBe('The vault door is sealed.');
    expect(await send('look')).toContain('Gatehouse');
  });

  it('lets what holds a thing refuse to give it up', async () => {
    expect(await send('take gem from chest')).toBe(
      'The chest snaps shut on your fingers.'
    );
    expect(await send('i')).toBe('You are empty-handed.');
  });

  it('lets where a thing is going refuse it', async () => {
    await send('take rock');
    await send('east');

    expect(await send('drop rock')).toBe(
      'The floor is too hot to put anything down.'
    );
    expect(await send('i')).toBe('You are carrying: the rock.');
  });

  it("asks nothing when the action can't happen anyway", async () => {
    expect(await send('west')).toBe("You can't go west from here.");
  });
});
