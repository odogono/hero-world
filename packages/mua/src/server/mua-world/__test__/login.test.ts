import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { MuaWorld, type MuaConnection } from '../index';
import { findPlayerByName } from '../queries/player';

type Client = MuaConnection & {
  closed: boolean;
  messages: { data: string; prompt?: string; success?: boolean }[];
};

let count = 0;

const client = (): Client => {
  const messages: Client['messages'] = [];
  const conn: Client = {
    close: () => {
      conn.closed = true;
    },
    closed: false,
    id: `ws-${++count}`,
    messages,
    send: data => {
      messages.push(JSON.parse(String(data)) as Client['messages'][number]);
      return 1;
    }
  };
  return conn;
};

describe('Logging in with a password', () => {
  let world: MuaWorld;

  /** Opens a connection, as a client connecting would */
  const connect = () => {
    const conn = client();
    world.onConnectionOpened(conn);
    return conn;
  };

  /** Sends a line and returns the reply, once it has come */
  const say = async (conn: Client, text: string) => {
    const before = conn.messages.length;
    world.onConnectionCommand(conn, text);
    for (let ii = 0; ii < 100 && conn.messages.length === before; ii++) {
      await Bun.sleep(1);
    }
    return conn.messages.at(-1);
  };

  beforeEach(async () => {
    world = new MuaWorld({ passwordCost: 4 });
    await world.open();
    clearInterval(world.updateLoopInterval!);
  });

  afterEach(async () => {
    await world.close();
  });

  it('asks a new player to choose a password', async () => {
    const conn = connect();

    expect(await say(conn, 'bob')).toEqual({
      data: 'Welcome, bob! Choose a password (at least 4 characters):',
      prompt: 'password',
      success: true
    });
    expect((await say(conn, 'abc'))?.data).toBe(
      'A password needs at least 4 characters. Choose a password:'
    );
    expect((await say(conn, 'hunter2'))?.data).toContain('Welcome, bob!');
  });

  it('keeps the password hashed, never as written', async () => {
    const conn = connect();
    await say(conn, 'bob');
    await say(conn, 'hunter2');

    const bob = findPlayerByName(world.world!, 'bob')!;
    const { hash } = world.world!.query({
      entity: { id: bob.id, world: world.world! },
      with: ['credentials']
    })!.credentials;
    expect(hash).not.toContain('hunter2');
    expect(await Bun.password.verify('hunter2', hash)).toBe(true);
  });

  it('asks a returning player for their password', async () => {
    const first = connect();
    await say(first, 'bob');
    await say(first, 'hunter2');
    world.onConnectionClosed(first);

    const again = connect();
    expect((await say(again, 'bob'))?.data).toBe('Password for bob:');
    expect((await say(again, 'wrong'))?.data).toBe('Wrong password. Password:');
    expect((await say(again, 'hunter2'))?.data).toContain('Welcome, bob!');
  });

  it('closes the connection after three wrong passwords', async () => {
    const first = connect();
    await say(first, 'bob');
    await say(first, 'hunter2');
    world.onConnectionClosed(first);

    const thief = connect();
    await say(thief, 'bob');
    await say(thief, 'guess1');
    await say(thief, 'guess2');
    expect((await say(thief, 'guess3'))?.data).toBe(
      'Too many wrong passwords. Goodbye.'
    );
    expect(thief.closed).toBe(true);
  });

  it('refuses a name that is not one', async () => {
    const conn = connect();

    expect((await say(conn, '!!'))?.data).toContain(
      'Please enter your username:'
    );
  });

  it('takes a name and password in one message', async () => {
    const first = connect();
    world.onConnectionCommand(first, {
      data: { password: 'hunter2', username: 'bob' }
    });
    await Bun.sleep(20);
    expect(first.messages.at(-1)?.data).toContain('Welcome, bob!');
    world.onConnectionClosed(first);

    const wrong = connect();
    world.onConnectionCommand(wrong, {
      data: { password: 'nope', username: 'bob' }
    });
    await Bun.sleep(20);
    expect(wrong.messages.at(-1)?.data).toBe('Wrong password. Password:');
  });
});
