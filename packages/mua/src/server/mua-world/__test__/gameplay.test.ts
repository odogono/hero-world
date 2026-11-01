import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getEntity, getLocationOf } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { openTestWorld } from './helpers';

describe('Gameplay', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;

  beforeEach(async () => {
    world = await openTestWorld();
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  const login = (name: string) => world.login(name);
  const send: typeof world.send = (conn, text) => world.send(conn, text);

  it('looks at the starting room', async () => {
    const conn = await login('bob');

    const output = await send(conn, 'look');

    expect(output).toContain('West of house');
    expect(output).toContain('Mailbox');
    expect(output).toContain('Exits: north, south');
  });

  it('moves through an exit and describes the new room', async () => {
    const conn = await login('bob');

    expect(await send(conn, 'north')).toContain('North of house');
    expect(await send(conn, 'look')).toContain('North of house');
  });

  it('reports a blocked exit', async () => {
    const conn = await login('bob');
    await send(conn, 'north');

    expect(await send(conn, 's')).toContain('The windows are all barred');
  });

  it('lets door.talk veto a locked door, and exit.talk move through it', async () => {
    const conn = await login('bob');
    await send(conn, 'north');
    await send(conn, 'east');

    // give the window behind the house somewhere to go: only the door's
    // Script stops the player now
    const ecs = world.muaWorld.world!;
    const behind = getLocationOf(ecs, ecs.query({ with: ['player'] })!.id)!;
    const portalTo = findExitByDirection(ecs, behind, 'north')!.portal.to!;
    const window = getEntity(
      ecs,
      findExitByDirection(ecs, behind, 'west')!.id,
      ['door', 'portal'],
      true
    )!;
    window.portal = { ...window.portal, to: portalTo };
    ecs.flush();

    expect(await send(conn, 'west')).toBe('The window is closed');

    window.door = { isLocked: false };
    ecs.flush();
    expect(await send(conn, 'west')).toContain('North of house');
  });

  it('tells others in the room when someone arrives', async () => {
    const alice = await login('alice');
    await send(alice, 'north');

    const bob = await login('bob');
    alice.messages.length = 0;
    await send(bob, 'north');

    expect(alice.messages.join('\n')).toContain('bob arrives.');
  });

  it('says something to the room', async () => {
    const alice = await login('alice');
    const bob = await login('bob');
    alice.messages.length = 0;

    expect(await send(bob, 'say Hello Alice')).toContain(
      'You say, "Hello Alice"'
    );
    expect(alice.messages.join('\n')).toContain('bob says, "Hello Alice"');
  });

  it('repeats the previous command with again', async () => {
    const conn = await login('bob');

    expect(await send(conn, 'g')).toContain('There is nothing to repeat.');
    await send(conn, 'north');
    expect(await send(conn, 'again')).toContain(
      "You can't go north from here."
    );
  });
});
