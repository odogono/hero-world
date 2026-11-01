import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

/** The walled garden in the main world, east of the house */
describe('The walled garden', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.sendAndWait(bob, text);
  const walk = async (...commands: string[]) => {
    for (const command of commands) {
      await send(command);
    }
  };

  beforeEach(async () => {
    world = await openTestWorld();
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('lies east of the house', async () => {
    await walk('north', 'east');

    expect(await send('east')).toContain('Garden Path');
  });

  it('smells of roses', async () => {
    await walk('north', 'east', 'east');

    expect(await send('smell')).toBe(
      'The air is thick with the scent of roses.'
    );
    expect(await send('sniff roses')).toContain('heady, sweet scent');
  });

  it('has a gardener who greets you and knows where the key is', async () => {
    await walk('north', 'east', 'east');

    expect(await send('north')).toContain(
      'Hollis says, "Mind the roses, bob."'
    );
    expect(await send('say have you seen a key?')).toContain(
      'Hollis says, "The shed key? I dropped it in the well bucket, I think."'
    );
  });

  it('opens the locked shed with the key from the well', async () => {
    await walk('north', 'east', 'east');
    expect(await send('east')).toBe('The shed door is closed.');
    expect(await send('open door')).toBe('The shed door is locked.');

    await walk('north', 'north', 'take key from bucket', 'south', 'south');
    await send('unlock door');
    expect(await send('open door')).toBe('Opened.');
    expect(await send('east')).toContain('Garden Shed');
    expect(await send('read catalogue')).toContain('Water them every evening');
  });

  it('lets you water the roses with the watering can', async () => {
    await walk('north', 'east', 'east', 'north', 'north');
    await walk('take key from bucket', 'south', 'south');
    await walk('unlock door', 'open door', 'east', 'take can', 'take trowel');
    await send('west');

    expect(await send('water roses with trowel')).toBe(
      "The trowel won't help the roses."
    );
    expect(await send('water roses with can')).toBe(
      'You water the roses. They drink gratefully and lift their heads.'
    );
  });

  it('has a gardener who potters off on his own', async () => {
    await walk('north', 'east', 'east', 'north');
    bob.messages.length = 0;

    for (let ii = 0; ii < 50; ii++) {
      await world.muaWorld.tick(1000);
    }

    expect(bob.messages).toContain('Hollis goes south.');
  });
});
