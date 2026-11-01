import { expect } from 'bun:test';

import { MuaWorld, type MuaConnection } from '../index';

export type TestConnection = MuaConnection & {
  messages: string[];
  /** Everything sent, as parsed JSON, including fields besides the text */
  payloads: Record<string, unknown>[];
};

const createConnection = (id: string): TestConnection => {
  const messages: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  return {
    close: () => {},
    id,
    messages,
    payloads,
    send: data => {
      const payload = JSON.parse(String(data)) as Record<string, unknown>;
      payloads.push(payload);
      messages.push(payload.data as string);
      return 1;
    }
  };
};

/**
 * Opens a MuaWorld that is driven by hand rather than on its interval,
 * with helpers to log players in and send commands.
 */
export const openTestWorld = async (mainEDL?: string, dbPath?: string) => {
  // the cheapest password hashing, so logging in doesn't slow the tests
  const muaWorld = new MuaWorld({ dbPath, mainEDL, passwordCost: 4 });
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
    muaWorld.onConnectionCommand(conn, {
      data: { password: `secret-${name}`, username: name }
    });
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
