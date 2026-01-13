import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { useCommandHistory } from '../hooks/use-command-history';
import { useDebugMode } from '../hooks/use-debug-mode';
import { useGameState } from '../hooks/use-game-state';
import { useWebSocket } from '../hooks/use-websocket';
import { completeVerb, KNOWN_VERBS } from '../utils/verb-completer';
import { createMockWebSocketConstructor, MockWebSocket } from './mocks/websocket';

/**
 * Integration tests for the TUI App
 * These tests verify that hooks work together correctly to support critical user flows
 */
describe('TUI App Integration', () => {
  let originalWebSocket: typeof WebSocket;
  let MockWSConstructor: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = global.WebSocket;
    MockWSConstructor = createMockWebSocketConstructor();
    (global as any).WebSocket = MockWSConstructor;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  describe('WebSocket Communication Flow', () => {
    it('connects on mount and sends commands with correct format', () => {
      const { result: wsResult } = renderHook(() => useWebSocket());
      const { result: gameStateResult } = renderHook(() => useGameState());

      // Connect to WebSocket
      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;
      expect(ws).toBeDefined();
      expect(ws.url).toBe('ws://localhost:3974/ws');

      // Simulate connection open
      act(() => {
        ws.simulateOpen();
      });

      // Send a command
      act(() => {
        wsResult.current.send({ payload: 'look', type: 'cmd' });
      });

      // Verify message format
      const sentMessages = ws.getSentMessages();
      expect(sentMessages.length).toBe(1);
      expect(JSON.parse(sentMessages[0])).toEqual({ payload: 'look', type: 'cmd' });
    });

    it('receives and displays server responses', () => {
      const onMessage = mock((data: any) => {
        if (data && data.data) {
          gameStateResult.current.addMessage(data.data, data.success ? 'game' : 'error');
        }
      });

      const { result: wsResult } = renderHook(() => useWebSocket(onMessage));
      const { result: gameStateResult } = renderHook(() => useGameState());

      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;

      // Simulate server response
      act(() => {
        ws.simulateMessage({ data: 'You look around the room.', success: true });
      });

      expect(onMessage).toHaveBeenCalledWith({ data: 'You look around the room.', success: true });
    });

    it('tracks connection status changes', () => {
      const onStatusChange = mock(() => {});
      const { result: wsResult } = renderHook(() => useWebSocket(undefined, onStatusChange));

      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;

      // Simulate connection events
      act(() => {
        ws.simulateOpen();
      });
      expect(onStatusChange).toHaveBeenCalledWith('connected');

      act(() => {
        ws.simulateClose();
      });
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');

      act(() => {
        ws.simulateError();
      });
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');
    });
  });

  describe('Command History Flow', () => {
    it('adds commands to history and navigates with arrows', () => {
      const { result: historyResult } = renderHook(() => useCommandHistory());

      // Submit multiple commands
      act(() => {
        historyResult.current.addCommand('look');
        historyResult.current.addCommand('go north');
        historyResult.current.addCommand('take sword');
      });

      expect(historyResult.current.history.length).toBe(3);

      // Navigate up (backward)
      let cmd;
      act(() => {
        cmd = historyResult.current.getPrevious();
      });
      expect(cmd).toBe('take sword');

      act(() => {
        cmd = historyResult.current.getPrevious();
      });
      expect(cmd).toBe('go north');

      // Navigate down (forward)
      act(() => {
        cmd = historyResult.current.getNext();
      });
      expect(cmd).toBe('take sword');
    });

    it('resets history index when user types', () => {
      const { result: historyResult } = renderHook(() => useCommandHistory());

      act(() => {
        historyResult.current.addCommand('look');
        historyResult.current.addCommand('go north');
      });

      // Navigate back in history
      act(() => {
        historyResult.current.getPrevious();
      });

      // User starts typing - reset index
      act(() => {
        historyResult.current.reset();
      });

      expect(historyResult.current.currentIndex).toBe(-1);
    });
  });

  describe('Tab Completion Flow', () => {
    it('completes verbs on tab press', () => {
      let inputValue = 'lo';

      const completed = completeVerb(inputValue, KNOWN_VERBS);
      expect(completed).toBe('look');

      inputValue = 'ta';
      const completed2 = completeVerb(inputValue, KNOWN_VERBS);
      expect(completed2).toBe('take');
    });

    it('preserves arguments when completing verb', () => {
      const inputValue = 'ta sword';
      const completed = completeVerb(inputValue, KNOWN_VERBS);
      expect(completed).toBe('take sword');
    });

    it('does nothing when no match found', () => {
      const inputValue = 'xyz';
      const completed = completeVerb(inputValue, KNOWN_VERBS);
      expect(completed).toBeNull();
    });
  });

  describe('Room Data Extraction Flow', () => {
    it('extracts and stores room data from look command response', () => {
      const { result: gameStateResult } = renderHook(() => useGameState());

      const roomResponse = `Town Square
A bustling marketplace with vendors selling their wares.
You see: sword, shield, potion
Exits: north, south, east`;

      act(() => {
        gameStateResult.current.addMessage(roomResponse, 'game');
      });

      // Verify room data was extracted
      expect(gameStateResult.current.currentRoom).not.toBeNull();
      expect(gameStateResult.current.currentRoom?.name).toBe('Town Square');
      expect(gameStateResult.current.currentRoom?.description).toContain('bustling marketplace');
      expect(gameStateResult.current.currentRoom?.exits).toEqual(['north', 'south', 'east']);
      expect(gameStateResult.current.currentRoom?.items).toEqual(['sword', 'shield', 'potion']);

      // Verify player location was updated
      expect(gameStateResult.current.playerState.location).toBe('Town Square');
    });

    it('does not extract room data from regular messages', () => {
      const { result: gameStateResult } = renderHook(() => useGameState());

      act(() => {
        gameStateResult.current.addMessage('You pick up the sword.', 'game');
      });

      // Room data should not be set
      expect(gameStateResult.current.currentRoom).toBeNull();
    });

    it('updates room when moving to new location', () => {
      const { result: gameStateResult } = renderHook(() => useGameState());

      const room1 = `Town Square
First room.
Exits: north`;

      const room2 = `Dark Forest
Second room.
Exits: south, west`;

      act(() => {
        gameStateResult.current.addMessage(room1, 'game');
      });
      expect(gameStateResult.current.playerState.location).toBe('Town Square');

      act(() => {
        gameStateResult.current.addMessage(room2, 'game');
      });
      expect(gameStateResult.current.playerState.location).toBe('Dark Forest');
      expect(gameStateResult.current.currentRoom?.exits).toEqual(['south', 'west']);
    });
  });

  describe('Debug Mode Flow', () => {
    it('starts and stops recording', () => {
      const { result: debugResult } = renderHook(() => useDebugMode());

      expect(debugResult.current.isRecording).toBe(false);

      act(() => {
        debugResult.current.startRecording();
      });

      expect(debugResult.current.isRecording).toBe(true);

      act(() => {
        debugResult.current.stopRecording();
      });

      expect(debugResult.current.isRecording).toBe(false);
    });

    it('replays commands with send function', async () => {
      const { result: debugResult } = renderHook(() => useDebugMode());
      const sendFn = mock(() => {});

      // Start recording
      act(() => {
        debugResult.current.startRecording();
      });

      // Replay (with no commands recorded, should complete immediately)
      await act(async () => {
        await debugResult.current.replay(sendFn);
      });

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('clears recorded commands', () => {
      const { result: debugResult } = renderHook(() => useDebugMode());

      act(() => {
        debugResult.current.clear();
      });

      expect(debugResult.current.recordedCommands).toEqual([]);
    });
  });

  describe('Complete User Flow: Send Command and Receive Response', () => {
    it('simulates complete command flow from input to display', () => {
      const { result: wsResult } = renderHook(() =>
        useWebSocket(data => {
          if (data && data.data) {
            gameStateResult.current.addMessage(data.data, data.success ? 'game' : 'error');
          }
        })
      );
      const { result: gameStateResult } = renderHook(() => useGameState());
      const { result: historyResult } = renderHook(() => useCommandHistory());

      // 1. Connect to server
      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;

      act(() => {
        ws.simulateOpen();
      });

      // 2. User types command
      const userCommand = 'look';

      // 3. User presses enter (onSubmit)
      act(() => {
        wsResult.current.send({ payload: userCommand, type: 'cmd' });
        historyResult.current.addCommand(userCommand);
      });

      // Verify command was sent
      const sentMessages = ws.getSentMessages();
      expect(sentMessages.length).toBe(1);
      expect(JSON.parse(sentMessages[0])).toEqual({ payload: 'look', type: 'cmd' });

      // Verify command was added to history
      expect(historyResult.current.history).toContain('look');

      // 4. Server responds with room description
      act(() => {
        ws.simulateMessage({
          data: `Town Square
A bustling marketplace.
Exits: north, south`,
          success: true
        });
      });

      // Verify message was added to game state
      expect(gameStateResult.current.messages.length).toBeGreaterThan(0);

      // Verify room data was extracted
      expect(gameStateResult.current.currentRoom?.name).toBe('Town Square');
      expect(gameStateResult.current.playerState.location).toBe('Town Square');
    });
  });

  describe('Error Handling Flow', () => {
    it('displays error messages from server', () => {
      const { result: wsResult } = renderHook(() =>
        useWebSocket(data => {
          if (data && data.data) {
            gameStateResult.current.addMessage(data.data, data.success ? 'game' : 'error');
          }
        })
      );
      const { result: gameStateResult } = renderHook(() => useGameState());

      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;

      // Server sends error
      act(() => {
        ws.simulateMessage({
          data: 'Unknown command',
          success: false
        });
      });

      // Verify error message was added
      const lastMessage = gameStateResult.current.messages[gameStateResult.current.messages.length - 1];
      expect(lastMessage.type).toBe('error');
      expect(lastMessage.content).toBe('Unknown command');
    });
  });

  describe('State Persistence Across Actions', () => {
    it('maintains state when performing multiple actions', () => {
      const { result: gameStateResult } = renderHook(() => useGameState());
      const { result: historyResult } = renderHook(() => useCommandHistory());

      // Add messages
      act(() => {
        gameStateResult.current.addMessage('Welcome', 'game');
        gameStateResult.current.addMessage('Type help for commands', 'system');
      });

      // Add commands
      act(() => {
        historyResult.current.addCommand('help');
        historyResult.current.addCommand('look');
      });

      // Update player state
      act(() => {
        gameStateResult.current.updatePlayerState({ health: 100, level: 5 });
      });

      // Verify all state is maintained
      expect(gameStateResult.current.messages.length).toBe(2);
      expect(historyResult.current.history.length).toBe(2);
      expect(gameStateResult.current.playerState.health).toBe(100);
      expect(gameStateResult.current.playerState.level).toBe(5);
    });
  });

  describe('Reconnection Flow', () => {
    it('handles disconnect and reconnect', () => {
      const { result: wsResult } = renderHook(() => useWebSocket());

      // Initial connection
      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      let ws = (MockWSConstructor as any).getLastInstance() as MockWebSocket;
      expect(ws.url).toBe('ws://localhost:3974/ws');

      // Disconnect
      act(() => {
        wsResult.current.disconnect();
      });

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      // Reconnect
      act(() => {
        wsResult.current.connect('ws://localhost:3974/ws');
      });

      const instances = (MockWSConstructor as any).instances;
      expect(instances.length).toBe(2); // New connection created
    });
  });
});
