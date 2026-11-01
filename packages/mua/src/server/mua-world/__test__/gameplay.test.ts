import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { MuaWorld, type MuaConnection } from '../index';

type TestConnection = MuaConnection & { messages: string[] };

const createConnection = (id: string): TestConnection => {
  const messages: string[] = [];
  return {
    close: () => {},
    id,
    messages,
    send: data => {
      const { data: message } = JSON.parse(String(data)) as { data: string };
      messages.push(message);
      return 1;
    }
  };
};

describe('Gameplay', () => {
  let muaWorld: MuaWorld;

  beforeEach(async () => {
    muaWorld = new MuaWorld();
    await muaWorld.open();
    // drive the loop by hand rather than on the 1s interval
    clearInterval(muaWorld.updateLoopInterval!);
  });

  afterEach(async () => {
    await muaWorld.close();
  });

  const tick = (count = 3) => {
    for (let ii = 0; ii < count; ii++) {
      muaWorld.loop!.update(1000);
    }
  };

  const login = async (name: string) => {
    const conn = createConnection(`ws-${name}`);
    muaWorld.onConnectionOpened(conn);
    muaWorld.onConnectionCommand(conn, { data: { username: name } });
    // handleLogin is fire-and-forget; wait for its welcome message
    for (let ii = 0; ii < 50 && conn.messages.length === 0; ii++) {
      await Bun.sleep(1);
    }
    expect(conn.messages.at(-1)).toContain(`Welcome, ${name}`);
    return conn;
  };

  const send = (conn: TestConnection, text: string) => {
    conn.messages.length = 0;
    muaWorld.onConnectionCommand(conn, text);
    tick();
    return conn.messages.join('\n');
  };

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
});
