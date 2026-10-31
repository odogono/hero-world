import { describe, expect, it } from 'bun:test';

import {
  extractRoomData,
  isRoomDescription,
  parseGameMessage
} from '../../utils/message-parser';

describe('message-parser', () => {
  describe('parseGameMessage', () => {
    it('creates game message for success', () => {
      const result = parseGameMessage({
        data: 'Welcome to the game',
        success: true
      });

      expect(result.type).toBe('game');
      expect(result.content).toBe('Welcome to the game');
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('creates error message for failure', () => {
      const result = parseGameMessage({
        data: 'Error occurred',
        success: false
      });

      expect(result.type).toBe('error');
      expect(result.content).toBe('Error occurred');
    });

    it('handles empty data', () => {
      const result = parseGameMessage({ data: '', success: true });

      expect(result.content).toBe('');
      expect(result.type).toBe('game');
    });

    it('generates unique IDs', () => {
      const result1 = parseGameMessage({ data: 'msg1', success: true });
      const result2 = parseGameMessage({ data: 'msg2', success: true });

      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('isRoomDescription', () => {
    it('identifies room descriptions with Exits', () => {
      expect(isRoomDescription('A room\nExits: north, south')).toBe(true);
    });

    it('identifies room descriptions with You see', () => {
      expect(isRoomDescription('A room\nYou see: sword, shield')).toBe(true);
    });

    it('identifies room descriptions with both', () => {
      expect(isRoomDescription('A room\nYou see: sword\nExits: north')).toBe(
        true
      );
    });

    it('rejects non-room content', () => {
      expect(isRoomDescription('Just a regular message')).toBe(false);
    });

    it('rejects empty content', () => {
      expect(isRoomDescription('')).toBe(false);
    });
  });

  describe('extractRoomData', () => {
    it('extracts room name from first line', () => {
      const content = 'Town Square\nA bustling marketplace.';
      const result = extractRoomData(content);

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Town Square');
    });

    it('extracts room description', () => {
      const content = `Town Square
A bustling marketplace.
Merchants call out their wares.`;

      const result = extractRoomData(content);
      expect(result?.description).toBe(
        'A bustling marketplace.\nMerchants call out their wares.'
      );
    });

    it('extracts exits', () => {
      const content = `Town Square
A bustling marketplace.
Exits: north, south, east`;

      const result = extractRoomData(content);
      expect(result?.exits).toEqual(['north', 'south', 'east']);
    });

    it('extracts items from You see line', () => {
      const content = `Room Name
Description here
You see: sword, shield, potion
Exits: north`;

      const result = extractRoomData(content);
      expect(result?.items).toEqual(['sword', 'shield', 'potion']);
    });

    it('extracts NPCs from There is line', () => {
      const content = `Room Name
Description
There is: guard, merchant
Exits: north`;

      const result = extractRoomData(content);
      expect(result?.npcs).toEqual(['guard', 'merchant']);
    });

    it('extracts NPCs from Here line', () => {
      const content = `Room Name
Description
Here: guard, merchant
Exits: north`;

      const result = extractRoomData(content);
      expect(result?.npcs).toEqual(['guard', 'merchant']);
    });

    it('returns null for empty content', () => {
      expect(extractRoomData('')).toBeNull();
    });

    it('handles content with only room name', () => {
      const result = extractRoomData('Just Room Name');

      expect(result?.name).toBe('Just Room Name');
      expect(result?.description).toBe('');
      expect(result?.exits).toEqual([]);
      expect(result?.items).toEqual([]);
      expect(result?.npcs).toEqual([]);
    });

    it('stops description at first Exits or You see line', () => {
      const content = `Town Square
Line 1 of description
Line 2 of description
You see: sword
Line after items should not be in description
Exits: north`;

      const result = extractRoomData(content);
      expect(result?.description).toBe(
        'Line 1 of description\nLine 2 of description'
      );
    });

    it('handles whitespace and empty lines', () => {
      const content = `

      Town Square

      Description here

      Exits: north
      `;

      const result = extractRoomData(content);
      expect(result?.name).toBe('Town Square');
      expect(result?.exits).toEqual(['north']);
    });
  });
});
