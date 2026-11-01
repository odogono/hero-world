import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/after.edl';

describe('Adding to a built-in reply', () => {
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

  it("adds the target's reply to the built-in's", async () => {
    expect(await send('examine orb')).toBe('A glass orb.\nIt hums faintly.');
  });

  it('leaves things without an after handler alone', async () => {
    expect(await send('examine rock')).toBe('A plain rock.');
  });

  it("adds the room's reply, after the target's", async () => {
    expect(await send('take orb')).toBe('Taken.\nDust swirls where it lay.');
  });

  it('asks nothing when the built-in refuses', async () => {
    await send('take orb');

    expect(await send('take orb')).toBe('You already have that.');
  });

  it('runs the built-in once, however long the Scripts take', async () => {
    await send('take rock');

    expect(await send('i')).toBe('You are carrying: the rock.');
  });
});
