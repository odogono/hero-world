import { describe, expect, test } from 'bun:test';
import { parseCommand } from '../commands/parser';

describe('Command Parser', () => {
  describe('Look command', () => {
    test('should parse "look"', () => {
      const result = parseCommand('look');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('look');
        expect(result.command.target).toBeUndefined();
      }
    });

    test('should parse "l" (alias)', () => {
      const result = parseCommand('l');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('look');
      }
    });

    test('should parse "examine" (alias)', () => {
      const result = parseCommand('examine');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('look');
      }
    });

    test('should parse "look mailbox" with target', () => {
      const result = parseCommand('look mailbox');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('look');
        expect(result.command.target).toBe('mailbox');
      }
    });
  });

  describe('Move command', () => {
    test('should parse "go north"', () => {
      const result = parseCommand('go north');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('north');
      }
    });

    test('should parse "move south"', () => {
      const result = parseCommand('move south');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('south');
      }
    });

    test('should parse "n" (standalone direction)', () => {
      const result = parseCommand('n');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('north');
      }
    });

    test('should parse "south" (standalone direction)', () => {
      const result = parseCommand('south');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('south');
      }
    });

    test('should parse "e" (east alias)', () => {
      const result = parseCommand('e');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('east');
      }
    });

    test('should parse "w" (west alias)', () => {
      const result = parseCommand('w');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('move');
        expect(result.command.direction).toBe('west');
      }
    });

    test('should fail with missing direction', () => {
      const result = parseCommand('go');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Where do you want to go');
      }
    });
  });

  describe('Error cases', () => {
    test('should fail with empty input', () => {
      const result = parseCommand('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Please enter a command');
      }
    });

    test('should fail with whitespace only', () => {
      const result = parseCommand('   ');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Please enter a command');
      }
    });

    test('should fail with unknown command', () => {
      const result = parseCommand('foobar');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Unknown command');
      }
    });
  });

  describe('Raw input preservation', () => {
    test('should preserve original input', () => {
      const result = parseCommand('LOOK Around');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.rawInput).toBe('LOOK Around');
      }
    });
  });
});
