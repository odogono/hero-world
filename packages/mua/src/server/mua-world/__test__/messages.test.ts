import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { renderTemplate } from '../actions/messages';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/objects.edl';

describe('renderTemplate', () => {
  const values = {
    actor: 'bob',
    dir: 'north',
    target: 'lamp',
    the: { target: 'the lamp' }
  };

  it('fills in names, with or without "the"', async () => {
    expect(renderTemplate('{actor} takes {the target}.', values)).toBe(
      'bob takes the lamp.'
    );
    expect(renderTemplate('{actor} goes {dir}.', values)).toBe(
      'bob goes north.'
    );
  });

  it('capitalises a placeholder written with a capital', async () => {
    expect(renderTemplate('{The target} glows. {Actor} grins.', values)).toBe(
      'The lamp glows. Bob grins.'
    );
  });

  it('leaves unknown placeholders alone', async () => {
    expect(renderTemplate('{actor} eyes {the indirect}.', values)).toBe(
      'bob eyes {the indirect}.'
    );
  });
});

describe('Messages', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;
  let alice: TestConnection;

  const send = (text: string) => world.send(bob, text);
  const aliceHeard = () => alice.messages.join('\n');

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
    alice = await world.login('alice');
    alice.messages.length = 0;
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it("uses a thing's own message for the actor", async () => {
    expect(await send('take vase')).toBe('You lift the vase with both hands.');
    expect(aliceHeard()).toContain('bob takes the vase.');
  });

  it('uses a message inherited from an atom for everyone else', async () => {
    await send('take vase');
    alice.messages.length = 0;

    expect(await send('drop vase')).toBe('Dropped.');
    expect(aliceHeard()).toContain('bob sets the vase down very gently.');
  });

  it('tells the room left behind where someone went', async () => {
    await send('east');

    expect(aliceHeard()).toContain('bob goes east.');
  });

  it("uses an exit's messages for leaving, passing and arriving", async () => {
    await send('east');
    alice.messages.length = 0;

    expect(await send('down')).toContain('You drop through the trapdoor.');
    expect(aliceHeard()).toContain('bob tumbles out of the ceiling.');
  });
});

describe('look', () => {
  it('sends what the room holds alongside the text', async () => {
    const world = await openTestWorld(FIXTURE);
    const bob = await world.login('bob');
    await world.login('alice');
    bob.payloads.length = 0;

    await world.send(bob, 'look');

    expect(bob.payloads.at(-1)?.room).toEqual({
      description: 'A cluttered workshop.',
      exits: ['east'],
      items: expect.arrayContaining(['Lamp', 'Crate', 'Vase']),
      name: 'Workshop',
      players: ['alice']
    });
    await world.muaWorld.close();
  });
});
