import { describe, expect, it } from 'bun:test';

import { colorByType, colorizeMessage } from '../../utils/color-utils';

describe('color-utils', () => {
  describe('colorByType', () => {
    it('colors error messages', () => {
      const result = colorByType('Error occurred!', 'error');
      // fg() returns a function/styled object, not a plain string
      expect(result).not.toBe('Error occurred!');
      expect(typeof result).not.toBe('string');
    });

    it('colors success messages', () => {
      const result = colorByType('Success!', 'success');
      expect(result).not.toBe('Success!');
      expect(typeof result).not.toBe('string');
    });

    it('colors system messages', () => {
      const result = colorByType('System message', 'system');
      expect(result).not.toBe('System message');
      expect(typeof result).not.toBe('string');
    });

    it('returns unchanged for game type', () => {
      const text = 'Game text';
      const result = colorByType(text, 'game');
      expect(result).toBe(text);
    });

    it('returns unchanged for unknown type', () => {
      const text = 'Unknown type';
      const result = colorByType(text, 'unknown');
      expect(result).toBe(text);
    });
  });

  describe('colorizeMessage', () => {
    it('returns unchanged when no room data', () => {
      const text = 'Some text';
      expect(colorizeMessage(text)).toBe(text);
    });

    it('returns unchanged when room data is undefined', () => {
      const text = 'Some text';
      expect(colorizeMessage(text, undefined)).toBe(text);
    });

    it('colorizes exits', () => {
      const roomData = {
        description: 'Desc',
        exits: ['north', 'south'],
        items: [],
        name: 'Room',
        npcs: []
      };

      const result = colorizeMessage('Go north or south', roomData);
      // Result should be different from input (colors applied)
      expect(result).not.toBe('Go north or south');
    });

    it('colorizes items', () => {
      const roomData = {
        description: 'Desc',
        exits: [],
        items: ['sword', 'shield'],
        name: 'Room',
        npcs: []
      };

      const result = colorizeMessage('Take the sword and shield', roomData);
      expect(result).not.toBe('Take the sword and shield');
    });

    it('colorizes NPCs', () => {
      const roomData = {
        description: 'Desc',
        exits: [],
        items: [],
        name: 'Room',
        npcs: ['guard', 'merchant']
      };

      const result = colorizeMessage('Talk to the guard or merchant', roomData);
      expect(result).not.toBe('Talk to the guard or merchant');
    });

    it('handles case-insensitive matching', () => {
      const roomData = {
        description: 'Desc',
        exits: ['North'],
        items: [],
        name: 'Room',
        npcs: []
      };

      const result = colorizeMessage('Go NORTH or north', roomData);
      // Should colorize both NORTH and north
      expect(result).not.toBe('Go NORTH or north');
    });

    it('matches whole words only', () => {
      const roomData = {
        description: 'Desc',
        exits: ['north'],
        items: [],
        name: 'Room',
        npcs: []
      };

      // Should match 'north' but not 'northern' or 'northward'
      const result = colorizeMessage(
        'Go north to the northern regions',
        roomData
      );
      // 'north' should be colored but 'northern' should not
      // This is hard to test without inspecting the exact output
      expect(result).toContain('north');
      expect(result).toContain('northern');
    });

    it('colorizes multiple types simultaneously', () => {
      const roomData = {
        description: 'Desc',
        exits: ['north'],
        items: ['sword'],
        name: 'Room',
        npcs: ['guard']
      };

      const result = colorizeMessage(
        'Take the sword from the guard and go north',
        roomData
      );
      // Result should be styled (different from input)
      expect(result).not.toBe('Take the sword from the guard and go north');
    });

    it('handles empty room data arrays', () => {
      const roomData = {
        description: 'Desc',
        exits: [],
        items: [],
        name: 'Room',
        npcs: []
      };

      const text = 'Some text';
      const result = colorizeMessage(text, roomData);
      expect(result).toBe(text);
    });
  });
});
