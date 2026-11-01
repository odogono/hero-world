import { expect } from 'bun:test';

import { MuaWorld, type MuaConnection } from '../index';

export type TestConnection = MuaConnection & { messages: string[] };

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

/**
 * Opens a MuaWorld that is driven by hand rather than on its interval,
 * with helpers to log players in and send commands.
 */
export const openTestWorld = async (mainEDL?: string) => {
  const muaWorld = new MuaWorld({ mainEDL });
  await muaWorld.open();
  clearInterval(muaWorld.updateLoopInterval!);

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

  /** Sends a command and returns everything the sender was told */
  const send = (conn: TestConnection, text: string) => {
    conn.messages.length = 0;
    muaWorld.onConnectionCommand(conn, text);
    tick();
    return conn.messages.join('\n');
  };

  /** Sends a command, runs one full tick (Scripts included), and returns what the sender was told */
  const sendAndWait = async (conn: TestConnection, text: string) => {
    conn.messages.length = 0;
    muaWorld.onConnectionCommand(conn, text);
    await muaWorld.tick(1000);
    return conn.messages.join('\n');
  };

  return { login, muaWorld, send, sendAndWait, tick };
};
