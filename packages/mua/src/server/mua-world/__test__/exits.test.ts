import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { expandExits } from '../world/exits';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/exits.edl';

describe('Exits shorthand', () => {
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

  it('makes an exit to the room named', async () => {
    expect(await send('north')).toContain('Library');
  });

  it('makes the way back', async () => {
    // the cellar's `up` makes the hall's `down`
    expect(await send('down')).toContain('Cellar');
    expect(await send('up')).toContain('Hall');
  });

  it('leaves out the way back for a one-way exit', async () => {
    await send('east');
    expect(await send('west')).toBe("You can't go west from here.");
  });

  it('says why an exit that leads nowhere is closed', async () => {
    expect(await send('west')).toBe("A painted door. It doesn't open.");
  });

  it('keeps an exit declared as an entity over the way back', async () => {
    await send('north');
    expect(await send('south')).toBe('A bookcase blocks the way.');
  });

  it('keeps an exit the room declares over a way back', async () => {
    // the study's south exit would make the hall's north: the hall's own wins
    expect(await send('north')).toContain('Library');
  });

  it('makes nothing new when run again', async () => {
    const ecs = world.muaWorld.world!;
    const count = () => ecs.queryAll({ with: ['portal'] }).length;
    const before = count();

    expandExits(ecs);

    expect(count()).toBe(before);
  });
});
