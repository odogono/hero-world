import { describe, expect, it } from 'bun:test';

import { act, renderHook } from '@testing-library/react';

import { useGameState } from '../../hooks/use-game-state';

describe('useGameState', () => {
  it('initializes with empty messages and unknown location', () => {
    const { result } = renderHook(() => useGameState());

    expect(result.current.messages).toEqual([]);
    expect(result.current.playerState.location).toBe('Unknown');
    expect(result.current.currentRoom).toBeNull();
  });

  it('adds messages', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.addMessage('Hello world', 'game');
    });

    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0]!.content).toBe('Hello world');
    expect(result.current.messages[0]!.type).toBe('game');
    expect(result.current.messages[0]!.id).toBeDefined();
    expect(result.current.messages[0]!.timestamp).toBeDefined();
  });

  it('adds multiple messages with different types', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.addMessage('Game message', 'game');
      result.current.addMessage('Error message', 'error');
      result.current.addMessage('Success message', 'success');
      result.current.addMessage('System message', 'system');
    });

    expect(result.current.messages.length).toBe(4);
    expect(result.current.messages[0]!.type).toBe('game');
    expect(result.current.messages[1]!.type).toBe('error');
    expect(result.current.messages[2]!.type).toBe('success');
    expect(result.current.messages[3]!.type).toBe('system');
  });

  it('limits messages to MAX_MESSAGES (100)', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      for (let i = 0; i < 110; i++) {
        result.current.addMessage(`msg${i}`, 'game');
      }
    });

    expect(result.current.messages.length).toBe(100);
    // First 10 should be dropped, so first message should be 'msg10'
    expect(result.current.messages[0]!.content).toBe('msg10');
    expect(result.current.messages[99]!.content).toBe('msg109');
  });

  it('extracts room data from room descriptions', () => {
    const { result } = renderHook(() => useGameState());

    const roomDesc = `Town Square
A bustling marketplace with vendors selling their wares.
Exits: north, south, east
You see: sword, shield`;

    act(() => {
      result.current.addMessage(roomDesc, 'game');
    });

    expect(result.current.currentRoom).not.toBeNull();
    expect(result.current.currentRoom?.name).toBe('Town Square');
    expect(result.current.currentRoom?.description).toContain(
      'bustling marketplace'
    );
    expect(result.current.currentRoom?.exits).toEqual([
      'north',
      'south',
      'east'
    ]);
    expect(result.current.currentRoom?.items).toEqual(['sword', 'shield']);
    expect(result.current.playerState.location).toBe('Town Square');
  });

  it('does not extract room data from non-room messages', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.addMessage(
        'Just a regular message without room info',
        'game'
      );
    });

    expect(result.current.currentRoom).toBeNull();
    expect(result.current.playerState.location).toBe('Unknown');
  });

  it('updates player state', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.updatePlayerState({ health: 100, level: 5 });
    });

    expect(result.current.playerState.health).toBe(100);
    expect(result.current.playerState.level).toBe(5);
    expect(result.current.playerState.location).toBe('Unknown'); // Should keep existing location
  });

  it('partially updates player state', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.updatePlayerState({
        health: 100,
        level: 5,
        location: 'Forest'
      });
    });

    act(() => {
      result.current.updatePlayerState({ health: 80 }); // Only update health
    });

    expect(result.current.playerState.health).toBe(80);
    expect(result.current.playerState.level).toBe(5); // Should keep old value
    expect(result.current.playerState.location).toBe('Forest'); // Should keep old value
  });

  it('updates room data and location', () => {
    const { result } = renderHook(() => useGameState());

    const roomData = {
      description: 'A dark and mysterious cave',
      exits: ['west'],
      items: ['torch'],
      name: 'Dark Cave',
      npcs: ['bat']
    };

    act(() => {
      result.current.updateRoomData(roomData);
    });

    expect(result.current.currentRoom).toEqual(roomData);
    expect(result.current.playerState.location).toBe('Dark Cave');
  });

  it('clears all messages', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.addMessage('msg1', 'game');
      result.current.addMessage('msg2', 'game');
      result.current.addMessage('msg3', 'game');
    });

    expect(result.current.messages.length).toBe(3);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
  });

  it('preserves player state when clearing messages', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.updatePlayerState({ health: 100, level: 5 });
      result.current.addMessage('msg1', 'game');
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.playerState.health).toBe(100);
    expect(result.current.playerState.level).toBe(5);
  });

  it('generates unique IDs for each message', () => {
    const { result } = renderHook(() => useGameState());

    act(() => {
      result.current.addMessage('msg1', 'game');
      result.current.addMessage('msg2', 'game');
      result.current.addMessage('msg3', 'game');
    });

    const ids = result.current.messages.map(m => m.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(3); // All IDs should be unique
  });

  it('extracts NPCs from room descriptions', () => {
    const { result } = renderHook(() => useGameState());

    const roomDesc = `Tavern
A cozy tavern with a warm fire.
There is: innkeeper, bard
Exits: north`;

    act(() => {
      result.current.addMessage(roomDesc, 'game');
    });

    expect(result.current.currentRoom?.npcs).toEqual(['innkeeper', 'bard']);
  });

  it('handles room updates overwriting previous room', () => {
    const { result } = renderHook(() => useGameState());

    const room1 = `Town Square
First room.
Exits: north`;

    const room2 = `Forest Path
Second room.
Exits: south`;

    act(() => {
      result.current.addMessage(room1, 'game');
    });

    expect(result.current.currentRoom?.name).toBe('Town Square');
    expect(result.current.playerState.location).toBe('Town Square');

    act(() => {
      result.current.addMessage(room2, 'game');
    });

    expect(result.current.currentRoom?.name).toBe('Forest Path');
    expect(result.current.playerState.location).toBe('Forest Path');
  });
});
