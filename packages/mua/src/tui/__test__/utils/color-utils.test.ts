import { describe, expect, it } from 'bun:test';

import { isStyledText, type StyledText } from '@opentui/core';

import { colorByType, colorizeMessage } from '../../utils/color-utils';

const room = (lists: {
  exits?: string[];
  items?: string[];
  npcs?: string[];
}) => ({
  description: 'Desc',
  exits: lists.exits ?? [],
  items: lists.items ?? [],
  name: 'Room',
  npcs: lists.npcs ?? []
});

/** The text of each chunk, with coloured chunks marked `*` */
const marked = (result: string | StyledText) =>
  isStyledText(result)
    ? result.chunks.map(c => (c.fg ? `*${c.text}` : c.text))
    : [result];

describe('color-utils', () => {
  describe('colorByType', () => {
    it.each(['error', 'success', 'system'])(
      'colours %s messages whole',
      type => {
        expect(marked(colorByType('Some text', type))).toEqual(['*Some text']);
      }
    );

    it.each(['game', 'unknown'])('leaves %s messages as text', type => {
      expect(colorByType('Some text', type)).toBe('Some text');
    });
  });

  describe('colorizeMessage', () => {
    it('returns text unchanged without room data', () => {
      expect(colorizeMessage('Some text')).toBe('Some text');
      expect(colorizeMessage('Some text', undefined)).toBe('Some text');
    });

    it('returns text unchanged when nothing matches', () => {
      expect(colorizeMessage('Some text', room({ exits: ['north'] }))).toBe(
        'Some text'
      );
      expect(colorizeMessage('Some text', room({}))).toBe('Some text');
    });

    it('colours exits, items and NPCs', () => {
      const result = colorizeMessage(
        'Take the sword from the guard and go north',
        room({ exits: ['north'], items: ['sword'], npcs: ['guard'] })
      );
      expect(marked(result)).toEqual([
        'Take the ',
        '*sword',
        ' from the ',
        '*guard',
        ' and go ',
        '*north'
      ]);
    });

    it('matches case-insensitively, keeping the text as written', () => {
      expect(
        marked(colorizeMessage('Go NORTH or north', room({ exits: ['North'] })))
      ).toEqual(['Go ', '*NORTH', ' or ', '*north']);
    });

    it('matches whole words only', () => {
      expect(
        marked(
          colorizeMessage(
            'Go north to the northern regions',
            room({ exits: ['north'] })
          )
        )
      ).toEqual(['Go ', '*north', ' to the northern regions']);
    });

    it('prefers the longest name, and treats punctuation in names literally', () => {
      expect(
        marked(
          colorizeMessage(
            'An iron sword, a sword and Mr. Smith',
            room({ items: ['sword', 'iron sword'], npcs: ['Mr. Smith'] })
          )
        )
      ).toEqual([
        'An ',
        '*iron sword',
        ', a ',
        '*sword',
        ' and ',
        '*Mr. Smith'
      ]);
    });
  });
});
