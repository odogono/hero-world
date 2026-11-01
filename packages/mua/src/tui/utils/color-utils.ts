import { StyledText, fg, stringToStyledText } from '@opentui/core';

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

const escapeRegExp = (text: string) =>
  text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);

const plain = (text: string) => stringToStyledText(text).chunks;

/**
 * Colour the room's exits, items and NPCs where they appear as whole words
 * (case-insensitive). Returns the content unchanged when nothing matches.
 */
export const colorizeMessage = (
  content: string,
  roomData?: RoomData
): string | StyledText => {
  if (!roomData) {
    return content;
  }

  // the first list a word appears in decides its colour
  const colorOf = new Map<string, string>();
  const add = (words: string[] | undefined, color: string) => {
    for (const word of words ?? []) {
      const key = word.toLowerCase();
      if (key && !colorOf.has(key)) {
        colorOf.set(key, color);
      }
    }
  };
  add(roomData.exits, COLORS.exit);
  add(roomData.items, COLORS.item);
  add(roomData.npcs, COLORS.npc);
  if (colorOf.size === 0) {
    return content;
  }

  // longest first, so 'iron sword' wins over 'sword'
  const words = [...colorOf.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    String.raw`\b(?:${words.map(escapeRegExp).join('|')})\b`,
    'gi'
  );

  const chunks = [];
  let last = 0;
  for (const match of content.matchAll(pattern)) {
    const start = match.index;
    if (start > last) {
      chunks.push(...plain(content.slice(last, start)));
    }
    chunks.push(fg(colorOf.get(match[0].toLowerCase())!)(match[0]));
    last = start + match[0].length;
  }
  if (chunks.length === 0) {
    return content;
  }
  if (last < content.length) {
    chunks.push(...plain(content.slice(last)));
  }
  return new StyledText(chunks);
};

/**
 * Colour a whole message by its type: errors, successes and system lines.
 */
export const colorByType = (
  content: string,
  type: string
): string | StyledText => {
  switch (type) {
    case 'error':
      return new StyledText([fg(COLORS.error)(content)]);
    case 'success':
      return new StyledText([fg(COLORS.success)(content)]);
    case 'system':
      return new StyledText([fg(COLORS.system)(content)]);
    default:
      return content;
  }
};
