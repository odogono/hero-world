import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { wsHandler } from '../handlers/ws';
import { MuaWorld, type MuaConnection } from '../mua-world';

type FakeWS = {
  id: string;
  send: (data: string) => void;
  sent: string[];
};

const createFakeWS = (id = 'ws-1'): FakeWS => {
  const ws: FakeWS = {
    id,
    send: data => ws.sent.push(data),
    sent: []
  };
  return ws;
};

describe('WebSocket Handler', () => {
  let muaWorld: MuaWorld;
  let handler: ReturnType<typeof wsHandler>;
  let openedCalls: MuaConnection[];
  let closedCalls: MuaConnection[];
  let commandCalls: { conn: MuaConnection; payload: unknown }[];

  beforeEach(() => {
    muaWorld = new MuaWorld();
    muaWorld.open();

    openedCalls = [];
    closedCalls = [];
    commandCalls = [];

    // Monkey-patch lifecycle methods to capture calls
    Object.assign(muaWorld, {
      onConnectionClosed: (conn: MuaConnection) => {
        closedCalls.push(conn);
      },
      onConnectionCommand: (conn: MuaConnection, payload: unknown) => {
        commandCalls.push({ conn, payload });
      },
      onConnectionOpened: (conn: MuaConnection) => {
        openedCalls.push(conn);
      }
    });
  });

  afterEach(() => {
    muaWorld.close();
  });

  it('open sends welcome message and notifies world', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.open?.(ws);

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      data: 'Welcome to MUA! Please enter your username:',
      success: true
    });
    expect(openedCalls.length).toBe(1);
    expect(openedCalls[0]!.id).toBe(ws.id);
  });

  it('handles ping -> pong', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.message?.(ws, { type: 'ping' });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ data: 'pong', success: true });
  });

  it('handles chat echo', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.message?.(ws, { payload: 'hello', type: 'chat' });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      data: 'You said: hello',
      success: true
    });
  });

  it('handles join room', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.message?.(ws, { payload: { room: 'lobby' }, type: 'join' });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      data: 'Joined room: lobby',
      success: true
    });
  });

  it('routes cmd messages to muaWorld.onConnectionCommand', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    const payload = { action: 'look', args: [] };
    handler.message?.(ws, { payload, type: 'cmd' });

    expect(commandCalls.length).toBe(1);
    expect(commandCalls[0]!.conn.id).toBe(ws.id);
    expect(commandCalls[0]!.payload).toEqual(payload);
  });

  it('rejects invalid message object', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.message?.(ws, { type: 'invalid' });

    expect(ws.sent.length).toBe(1);
    // Handler stringifies error responses
    const payload = JSON.parse(ws.sent[0]!);
    expect(payload.success).toBe(false);
    expect(typeof payload.data).toBe('string');
  });

  it('rejects non-object message (string)', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.message?.(ws, 'not-json');

    expect(ws.sent.length).toBe(1);
    const payload = JSON.parse(ws.sent[0]!);
    expect(payload.success).toBe(false);
    expect(typeof payload.data).toBe('string');
  });

  it('close notifies world on disconnect', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    handler.close?.(ws);

    expect(closedCalls.length).toBe(1);
    expect(closedCalls[0]!.id).toBe(ws.id);
  });
});
