import { describe, expect, test } from 'bun:test';

import { parseCommand } from '../commands/parser';
import { listVerbs } from '../commands/verbs';

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

    test('should parse "look mailbox" as examine', () => {
      const result = parseCommand('look mailbox');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.verb).toBe('examine');
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

  describe('Verb forms', () => {
    test('drops articles from noun phrases', () => {
      const result = parseCommand('look at the mailbox');
      expect(result).toMatchObject({
        command: { target: 'mailbox', verb: 'examine' },
        success: true
      });
    });

    test('keeps multi-word noun phrases', () => {
      const result = parseCommand('examine small brass lamp');
      expect(result).toMatchObject({
        command: { target: 'small brass lamp', verb: 'examine' },
        success: true
      });
    });

    test('accepts extended directions', () => {
      expect(parseCommand('ne')).toMatchObject({
        command: { direction: 'northeast', verb: 'move' }
      });
      expect(parseCommand('go up')).toMatchObject({
        command: { direction: 'up', verb: 'move' }
      });
    });

    test('rejects a word that is not a direction', () => {
      const result = parseCommand('go banana');
      expect(result).toMatchObject({
        error: 'Where do you want to go?',
        success: false
      });
    });
  });

  describe('Say', () => {
    test('captures the rest of the input with its case', () => {
      const result = parseCommand('say Hello  there, Bob');
      expect(result).toMatchObject({
        command: { text: 'Hello  there, Bob', verb: 'say' },
        success: true
      });
    });

    test('treats a leading quote as say', () => {
      expect(parseCommand("'Hi all")).toMatchObject({
        command: { text: 'Hi all', verb: 'say' }
      });
      expect(parseCommand('"Hi all"')).toMatchObject({
        command: { text: 'Hi all', verb: 'say' }
      });
    });

    test('asks what to say when there is nothing', () => {
      expect(parseCommand('say')).toMatchObject({
        error: 'What do you want to say?',
        success: false
      });
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

describe('listVerbs', () => {
  test('lists every word that starts a command, once', () => {
    const verbs = listVerbs();

    expect(verbs).toEqual(expect.arrayContaining(['look', 'x', 'take']));
    expect(verbs).toEqual(expect.arrayContaining(['north', 'n', 'again']));
    expect(new Set(verbs).size).toBe(verbs.length);
  });
});
