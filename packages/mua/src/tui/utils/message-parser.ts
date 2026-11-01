import { type GameMessage, type RoomData } from '../types';

/**
 * Parse server response into GameMessage
 */
export const parseGameMessage = (response: {
  data: string;
  success: boolean;
}): GameMessage => {
  const isSuccess = response.success;
  const content = response.data || '';

  return {
    content,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type: isSuccess ? 'game' : 'error'
  };
};

/**
 * Extract room data from look command output
 */
export const extractRoomData = (content: string): RoomData | null => {
  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  // Room name is typically the first line
  const name = lines[0] || '';

  // Find where "You see:" or "Exits:" starts
  let descEndIndex = lines.length;
  for (const [i, line] of lines.entries()) {
    if (i === 0) {
      continue;
    }
    if (line.startsWith('You see:') || line.startsWith('Exits:')) {
      descEndIndex = i;
      break;
    }
  }

  // Description is lines between name and items/exits
  const description = lines.slice(1, descEndIndex).join('\n');

  // Extract exits
  const exitsLine = lines.find(l => l.startsWith('Exits:'));
  const exits = exitsLine
    ? exitsLine
        .replace('Exits:', '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean)
    : [];

  // Extract items
  const itemsLine = lines.find(l => l.startsWith('You see:'));
  const items = itemsLine
    ? itemsLine
        .replace('You see:', '')
        .split(',')
        .map(i => i.trim())
        .filter(Boolean)
    : [];

  // Extract NPCs (if the format includes them)
  const npcsLine = lines.find(
    l => l.startsWith('There is:') || l.startsWith('Here:')
  );
  const npcs = npcsLine
    ? npcsLine
        .replace(/^(There is:|Here:)/, '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean)
    : [];

  return {
    description,
    exits,
    items,
    name,
    npcs
  };
};

/**
 * Check if content looks like room description (from look command)
 */
export const isRoomDescription = (content: string): boolean =>
  content.includes('Exits:') || content.includes('You see:');
