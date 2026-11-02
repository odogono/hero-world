import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { listVerbs, vocabularyOf } from '../commands/verbs';
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
    expect(output).toContain('the mailbox');
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

  it('answers a command within one tick', async () => {
    const conn = await login('bob');
    conn.messages.length = 0;

    world.muaWorld.onConnectionCommand(conn, 'look');
    await world.muaWorld.tick(1000);

    expect(conn.messages.join('\n')).toContain('West of house');
  });

  it('sends the verbs to complete with the welcome', async () => {
    const conn = await login('bob');

    const welcome = conn.payloads.find(p =>
      String(p.data).startsWith('Welcome')
    );
    expect(welcome?.verbs).toEqual(
      listVerbs(vocabularyOf(world.muaWorld.world!))
    );
  });

  it('starts a look with the room, with no stray blank lines', async () => {
    const conn = await login('bob');

    expect(await send(conn, 'look')).toMatch(
      /^West of house\n.+\n\nThere is: the mailbox\nExits: north, south$/
    );
  });

  it('lists the commands for help', async () => {
    const conn = await login('bob');

    const help = await send(conn, 'help');
    expect(help).toContain('Commands: look, move, take');
    expect(help).toContain('read');
  });

  it('reads what is written on a thing', async () => {
    const conn = await login('bob');
    await send(conn, 'open mailbox');

    expect(await send(conn, 'read leaflet')).toStartWith('WELCOME TO MUA!');
    expect(await send(conn, 'read mailbox')).toBe(
      "There's nothing written on it."
    );
  });
});
