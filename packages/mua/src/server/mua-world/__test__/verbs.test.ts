import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { listVerbs, vocabularyOf } from '../commands/verbs';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/verbs.edl';

describe('Verbs a world adds', () => {
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

  it('understands a new verb, for the room to handle', async () => {
    expect(await send('pray')).toBe('A calm settles over you.');
    expect(await send('kneel')).toBe('A calm settles over you.');
  });

  it('binds a new verb to the things it names', async () => {
    expect(await send('pray to altar')).toBe('The altar glows faintly.');
  });

  it("says the verb's own incomplete message", async () => {
    expect(await send('pray to')).toBe('Pray to whom?');
  });

  it('refuses a new verb where nothing handles it', async () => {
    await send('east');

    expect(await send('pray')).toBe("You can't do that.");
  });

  it('adds forms to a built-in verb, which keeps its own', async () => {
    expect(await send('look under altar')).toBe(
      'Something is scratched into the stone beneath: SALVE.'
    );
    expect(await send('look')).toContain('Chapel');
    expect(await send('examine altar')).toBe('A stone altar.');
  });

  it('offers the new verbs to complete', async () => {
    const verbs = listVerbs(vocabularyOf(world.muaWorld.world!));
    expect(verbs).toEqual(expect.arrayContaining(['pray', 'kneel', 'look']));

    const welcome = bob.payloads.find(p =>
      String(p.data).startsWith('Welcome')
    );
    expect(welcome?.verbs).toEqual(verbs);
  });
});
