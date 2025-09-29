import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { wsHandler } from '../handlers/ws';
import { MuaWorld } from '../mua-world';

type FakeWS = {
  id: string;
  sent: any[];
  send: (data: any) => void;
};

const createFakeWS = (id = 'ws-1'): FakeWS => {
  const ws: FakeWS = {
    id,
    sent: [],
    send: data => ws.sent.push(data)
  };
  return ws;
};

describe('WebSocket Handler', () => {
  let muaWorld: MuaWorld;
  let handler: ReturnType<typeof wsHandler>;
  let openedCalls: any[];
  let closedCalls: any[];
  let commandCalls: any[];

  beforeEach(() => {
    muaWorld = new MuaWorld();
    muaWorld.open();

    openedCalls = [];
    closedCalls = [];
    commandCalls = [];

    // Monkey-patch lifecycle methods to capture calls
    (muaWorld as any).onConnectionOpened = (conn: any) => {
      openedCalls.push(conn);
    };
    (muaWorld as any).onConnectionClosed = (conn: any) => {
      closedCalls.push(conn);
    };
    (muaWorld as any).onConnectionCommand = (conn: any, payload: any) => {
      commandCalls.push({ conn, payload });
    };
  });

  afterEach(() => {
    muaWorld.close();
  });

  it('open sends welcome message and notifies world', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.open?.(ws);

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ message: 'Connected to echo server' });
    expect(openedCalls.length).toBe(1);
    expect(openedCalls[0].id).toBe(ws.id);
  });

  it('handles ping -> pong', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, { type: 'ping' });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ success: true, data: 'pong' });
  });

  it('handles chat echo', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, { type: 'chat', payload: 'hello' });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      success: true,
      data: 'You said: hello'
    });
  });

  it('handles join room', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, { type: 'join', payload: { room: 'lobby' } });

    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      success: true,
      data: 'Joined room: lobby'
    });
  });

  it('routes cmd messages to muaWorld.onConnectionCommand', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    const payload = { action: 'look', args: [] };
    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, { type: 'cmd', payload });

    expect(commandCalls.length).toBe(1);
    expect(commandCalls[0].conn.id).toBe(ws.id);
    expect(commandCalls[0].payload).toEqual(payload);
  });

  it('rejects invalid message object', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, { type: 'invalid' });

    expect(ws.sent.length).toBe(1);
    // Handler stringifies error responses
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.success).toBe(false);
    expect(typeof payload.data).toBe('string');
  });

  it('rejects non-object message (string)', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.message?.(ws as any, 'not-json');

    expect(ws.sent.length).toBe(1);
    const payload = JSON.parse(ws.sent[0]);
    expect(payload.success).toBe(false);
    expect(typeof payload.data).toBe('string');
  });

  it('close notifies world on disconnect', () => {
    handler = wsHandler({ muaWorld });
    const ws = createFakeWS();

    // @ts-expect-error Partial handler type
    handler.close?.(ws as any);

    expect(closedCalls.length).toBe(1);
    expect(closedCalls[0].id).toBe(ws.id);
  });
});
