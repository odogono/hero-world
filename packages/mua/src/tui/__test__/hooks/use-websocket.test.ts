import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { act, renderHook } from '@testing-library/react';

import { useWebSocket } from '../../hooks/use-websocket';
import {
  MockWebSocket,
  createMockWebSocketConstructor,
  type MockWebSocketConstructor
} from '../mocks/websocket';

describe('useWebSocket', () => {
  let originalWebSocket: typeof WebSocket;
  let MockWSConstructor: MockWebSocketConstructor;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    MockWSConstructor = createMockWebSocketConstructor();
    global.WebSocket = MockWSConstructor;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('connects to WebSocket URL', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;
    expect(lastInstance).toBeDefined();
    expect(lastInstance.url).toBe('ws://localhost:3974/ws');
  });

  it('calls onStatusChange with connected on open', async () => {
    const onStatusChange = mock(() => {});
    const { result } = renderHook(() =>
      useWebSocket(undefined, onStatusChange)
    );

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    await act(async () => {
      lastInstance.simulateOpen();
    });

    expect(onStatusChange).toHaveBeenCalledWith('connected');
  });

  it('calls onStatusChange with disconnected on close', async () => {
    const onStatusChange = mock(() => {});
    const { result } = renderHook(() =>
      useWebSocket(undefined, onStatusChange)
    );

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    await act(async () => {
      lastInstance.simulateClose();
    });

    expect(onStatusChange).toHaveBeenCalledWith('disconnected');
  });

  it('calls onStatusChange with disconnected on error', async () => {
    const onStatusChange = mock(() => {});
    const { result } = renderHook(() =>
      useWebSocket(undefined, onStatusChange)
    );

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    await act(async () => {
      lastInstance.simulateError();
    });

    expect(onStatusChange).toHaveBeenCalledWith('disconnected');
  });

  it('calls onMessageCallback when message received', async () => {
    const onMessage = mock(() => {});
    const { result } = renderHook(() => useWebSocket(onMessage));

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    await act(async () => {
      lastInstance.simulateMessage({ data: 'test', success: true });
    });

    expect(onMessage).toHaveBeenCalledWith({ data: 'test', success: true });
  });

  it('sends JSON stringified data', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    // Simulate connection open so send works
    act(() => {
      lastInstance.simulateOpen();
    });

    act(() => {
      result.current.send({ payload: 'look', type: 'cmd' });
    });

    const sentMessages = lastInstance.getSentMessages();
    expect(sentMessages.length).toBe(1);
    expect(JSON.parse(sentMessages[0])).toEqual({
      payload: 'look',
      type: 'cmd'
    });
  });

  it('disconnects and cleans up listeners', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    act(() => {
      result.current.disconnect();
    });

    // WebSocket should be closed
    expect(lastInstance.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('handles multiple connect calls (only creates one connection)', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
      result.current.connect('ws://localhost:3974/ws'); // Second call should be ignored
    });

    const instances = MockWSConstructor.instances;
    expect(instances.length).toBe(1);
  });

  it('updates callback refs when callbacks change', async () => {
    const onMessage1 = mock(() => {});
    const onMessage2 = mock(() => {});

    const { rerender, result } = renderHook(
      ({ callback }) => useWebSocket(callback),
      { initialProps: { callback: onMessage1 } }
    );

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const lastInstance = MockWSConstructor.getLastInstance()!;

    // Change the callback
    rerender({ callback: onMessage2 });

    // Send a message - should call the new callback
    await act(async () => {
      lastInstance.simulateMessage({ data: 'test', success: true });
    });

    expect(onMessage1).not.toHaveBeenCalled();
    expect(onMessage2).toHaveBeenCalledWith({ data: 'test', success: true });
  });

  it('can reconnect after disconnect', () => {
    const { result } = renderHook(() => useWebSocket());

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    act(() => {
      result.current.disconnect();
    });

    act(() => {
      result.current.connect('ws://localhost:3974/ws');
    });

    const instances = MockWSConstructor.instances;
    expect(instances.length).toBe(2); // Two separate connections created
  });
});
