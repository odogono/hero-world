import { describe, expect, it } from 'bun:test';

import {
  KNOWN_VERBS,
  completeVerb,
  getMatchingVerbs
} from '../../utils/verb-completer';

describe('verb-completer', () => {
  describe('completeVerb', () => {
    it('completes partial verb to first match', () => {
      expect(completeVerb('lo', KNOWN_VERBS)).toBe('look');
      expect(completeVerb('ta', KNOWN_VERBS)).toBe('take');
      expect(completeVerb('n', KNOWN_VERBS)).toBe('north');
    });

    it('preserves text after verb', () => {
      expect(completeVerb('ta sword', KNOWN_VERBS)).toBe('take sword');
      expect(completeVerb('go north', KNOWN_VERBS)).toBe('go north');
    });

    it('returns null for no match', () => {
      expect(completeVerb('xyz', KNOWN_VERBS)).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(completeVerb('', KNOWN_VERBS)).toBeNull();
      expect(completeVerb('   ', KNOWN_VERBS)).toBeNull();
    });

    it('is case insensitive', () => {
      expect(completeVerb('LO', KNOWN_VERBS)).toBe('look');
      expect(completeVerb('Go', KNOWN_VERBS)).toBe('go');
    });

    it('only completes first word', () => {
      expect(completeVerb('ta the sword', KNOWN_VERBS)).toBe('take the sword');
      expect(completeVerb('l around', KNOWN_VERBS)).toBe('look around');
    });

    it('handles exact match', () => {
      expect(completeVerb('look', KNOWN_VERBS)).toBe('look');
      expect(completeVerb('north', KNOWN_VERBS)).toBe('north');
    });
  });

  describe('getMatchingVerbs', () => {
    it('returns all matching verbs', () => {
      const matches = getMatchingVerbs('l', KNOWN_VERBS);
      expect(matches).toContain('look');
      expect(matches).toContain('l');
      expect(matches.length).toBeGreaterThan(1);
    });

    it('returns empty for no matches', () => {
      expect(getMatchingVerbs('xyz', KNOWN_VERBS)).toEqual([]);
    });

    it('returns empty for empty input', () => {
      expect(getMatchingVerbs('', KNOWN_VERBS)).toEqual([]);
      expect(getMatchingVerbs('   ', KNOWN_VERBS)).toEqual([]);
    });

    it('is case insensitive', () => {
      const matches = getMatchingVerbs('GO', KNOWN_VERBS);
      expect(matches).toContain('go');
    });

    it('only matches first word', () => {
      const matches = getMatchingVerbs('look around', KNOWN_VERBS);
      // Should match 'look' since first word 'look' matches
      expect(matches).toContain('look');
      // Note: 'l' won't match because first word is 'look', not 'l'
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
