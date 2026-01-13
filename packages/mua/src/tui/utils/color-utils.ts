import { fg } from '@opentui/core';

import { type RoomData } from '../types';

// Color scheme (Tokyonight theme)
export const COLORS = {
  error: '#f7768e', // Red
  exit: '#7aa2f7', // Blue
  item: '#e0af68', // Yellow
  npc: '#bb9af7', // Purple
  room: '#c0caf5', // White
  success: '#9ece6a', // Green
  system: '#565f89' // Gray
};

/**
 * Apply color coding to message content based on room data
 */
export const colorizeMessage = (content: string, roomData?: RoomData): string => {
  let result = content;

  if (!roomData) {
    return result;
  }

  // Color exits (case insensitive)
  if (roomData.exits && roomData.exits.length > 0) {
    roomData.exits.forEach(exit => {
      // Match whole words only
      const regex = new RegExp(`\\b${exit}\\b`, 'gi');
      result = result.replace(regex, match => fg(COLORS.exit, match));
    });
  }

  // Color items
  if (roomData.items && roomData.items.length > 0) {
    roomData.items.forEach(item => {
      // Match whole words only, case insensitive
      const regex = new RegExp(`\\b${item}\\b`, 'gi');
      result = result.replace(regex, match => fg(COLORS.item, match));
    });
  }

  // Color NPCs
  if (roomData.npcs && roomData.npcs.length > 0) {
    roomData.npcs.forEach(npc => {
      const regex = new RegExp(`\\b${npc}\\b`, 'gi');
      result = result.replace(regex, match => fg(COLORS.npc, match));
    });
  }

  return result;
};

/**
 * Apply color based on message type
 */
export const colorByType = (content: string, type: string): string => {
  switch (type) {
    case 'error':
      return fg(COLORS.error, content);
    case 'success':
      return fg(COLORS.success, content);
    case 'system':
      return fg(COLORS.system, content);
    default:
      return content;
  }
};
