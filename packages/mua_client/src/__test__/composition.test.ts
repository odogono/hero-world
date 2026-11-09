import { describe, expect, test } from 'bun:test';

import {
  abilities,
  fresh,
  problems,
  startFields,
  toSend,
  wordsOf
} from '../builder/composition';

const container = {
  buildable: true,
  columns: [
    { default: 10, name: 'capacity', type: 'float' },
    { default: false, name: 'is_closed', type: 'boolean' }
  ],
  name: 'container'
};
const noun = {
  buildable: true,
  columns: [{ default: null, name: 'words', type: 'array' }],
  name: 'noun'
};

describe('a composition', () => {
  test('starts with a name to fill in', () => {
    expect(fresh()).toEqual({ described: { description: '', name: '' } });
  });

  test("starts a card's fields at their defaults, and a noun from the name", () => {
    expect(startFields(container, fresh())).toEqual({
      capacity: 10,
      is_closed: false
    });
    const named = { described: { name: 'Canvas Satchel' } };
    expect(startFields(noun, named)).toEqual({ words: ['canvas', 'satchel'] });
    expect(wordsOf("Ada's old-fashioned  lamp!")).toEqual([
      "ada's",
      'old-fashioned',
      'lamp'
    ]);
  });

  test('sends only fields with a value, so an empty one takes its default', () => {
    expect(
      toSend({
        container: { capacity: null, is_closed: true },
        described: { description: '  ', name: 'Satchel' },
        item: {}
      })
    ).toEqual({
      container: { is_closed: true },
      described: { name: 'Satchel' },
      item: {}
    });
  });

  test('says what it lets a thing do', () => {
    expect(
      abilities({
        container: {},
        described: { name: 'Satchel' },
        item: { is_takeable: true },
        noun: { words: ['bag'] }
      })
    ).toEqual([
      'Can be seen and examined',
      'Can be carried',
      'Can hold things',
      'Can be opened and closed',
      'Answers to bag'
    ]);
    expect(abilities({ described: {}, item: { is_takeable: false } })).toEqual([
      'Can be seen and examined',
      'Stays where it is'
    ]);
  });

  test("finds what the World would refuse, against the Builder's limits", () => {
    expect(problems(fresh(), 20)).toEqual([
      { component: 'described', text: 'It needs a name.' }
    ]);
    expect(
      problems(
        {
          container: { capacity: 25 },
          described: { description: 'x'.repeat(501), name: 'x'.repeat(41) }
        },
        20
      ).map(p => p.text)
    ).toEqual([
      'A name can be at most 40 characters.',
      'A description can be at most 500 characters.',
      'A container can hold at most 20.'
    ]);
    expect(problems({ described: { name: 'Satchel' } }, 20)).toEqual([]);
  });
});
