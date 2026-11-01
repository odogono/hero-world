import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

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

    const output = send(conn, 'look');

    expect(output).toContain('West of house');
    expect(output).toContain('Mailbox');
    expect(output).toContain('Exits: north, south');
  });

  it('moves through an exit and describes the new room', async () => {
    const conn = await login('bob');

    expect(send(conn, 'north')).toContain('North of house');
    expect(send(conn, 'look')).toContain('North of house');
  });

  it('reports a blocked exit', async () => {
    const conn = await login('bob');
    send(conn, 'north');

    expect(send(conn, 's')).toContain('The windows are all barred');
  });

  it('tells others in the room when someone arrives', async () => {
    const alice = await login('alice');
    send(alice, 'north');

    const bob = await login('bob');
    alice.messages.length = 0;
    send(bob, 'north');

    expect(alice.messages.join('\n')).toContain('bob arrives.');
  });

  it('says something to the room', async () => {
    const alice = await login('alice');
    const bob = await login('bob');
    alice.messages.length = 0;

    expect(send(bob, 'say Hello Alice')).toContain('You say, "Hello Alice"');
    expect(alice.messages.join('\n')).toContain('bob says, "Hello Alice"');
  });

  it('repeats the previous command with again', async () => {
    const conn = await login('bob');

    expect(send(conn, 'g')).toContain('There is nothing to repeat.');
    send(conn, 'north');
    expect(send(conn, 'again')).toContain("You can't go north from here.");
  });

  it('answers a command within one tick', async () => {
    const conn = await login('bob');
    conn.messages.length = 0;

    world.muaWorld.onConnectionCommand(conn, 'look');
    world.tick(1);

    expect(conn.messages.join('\n')).toContain('West of house');
  });
});
