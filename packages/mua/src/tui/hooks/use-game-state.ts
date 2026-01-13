import { useCallback, useState } from 'react';

import { type GameMessage, type PlayerState, type RoomData } from '../types';
import { extractRoomData, isRoomDescription } from '../utils/message-parser';

const MAX_MESSAGES = 100;

export const useGameState = () => {
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [playerState, setPlayerState] = useState<PlayerState>({
    location: 'Unknown'
  });
  const [currentRoom, setCurrentRoom] = useState<RoomData | null>(null);

  /**
   * Add a new message to the history
   */
  const addMessage = useCallback((content: string, type: GameMessage['type'] = 'game') => {
    const newMessage: GameMessage = {
      content,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type
    };

    setMessages(prev => {
      const updated = [...prev, newMessage];
      // Keep only last MAX_MESSAGES
      return updated.slice(-MAX_MESSAGES);
    });

    // Try to extract room data if this looks like a room description
    if (isRoomDescription(content)) {
      const roomData = extractRoomData(content);
      if (roomData) {
        setCurrentRoom(roomData);
        // Update player location from room name
        setPlayerState(prev => ({
          ...prev,
          location: roomData.name
        }));
      }
    }
  }, []);

  /**
   * Update player state
   */
  const updatePlayerState = useCallback((updates: Partial<PlayerState>) => {
    setPlayerState(prev => ({
      ...prev,
      ...updates
    }));
  }, []);

  /**
   * Update room data
   */
  const updateRoomData = useCallback((room: RoomData) => {
    setCurrentRoom(room);
    setPlayerState(prev => ({
      ...prev,
      location: room.name
    }));
  }, []);

  /**
   * Clear all messages
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    addMessage,
    clearMessages,
    currentRoom,
    messages,
    playerState,
    updatePlayerState,
    updateRoomData
  };
};
