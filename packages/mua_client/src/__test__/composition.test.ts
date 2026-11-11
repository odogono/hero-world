import { describe, expect, test } from 'bun:test';

import {
  abilities,
  fresh,
  patchOf,
  problems,
  startFields,
  toSend,
  unchanged,
  wordsOf
} from '../composer/composition';

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

describe('an edit as a patch (#275)', () => {
  const opened = {
    container: { capacity: 5, is_closed: true },
    described: { description: 'A leather satchel.', name: 'Satchel' },
    item: { is_takeable: true, weight: 1 }
  };

  test('is empty while nothing has changed', () => {
    expect(unchanged(patchOf(opened, structuredClone(opened)))).toBe(true);
  });

  test('puts only the fields that changed, so play keeps the rest', () => {
    expect(
      patchOf(opened, {
        ...opened,
        container: { capacity: 8, is_closed: true },
        described: { ...opened.described, description: 'A battered satchel.' }
      })
    ).toEqual({
      put: {
        container: { capacity: 8 },
        described: { description: 'A battered satchel.' }
      },
      remove: []
    });
  });

  test('puts a new component whole, and removes one that is gone', () => {
    const { item: _item, ...rest } = opened;
    expect(
      patchOf(opened, { ...rest, readable: { text: 'Ada', unused: '' } })
    ).toEqual({ put: { readable: { text: 'Ada' } }, remove: ['item'] });
  });

  test('a component removed and added back is a change of its fields', () => {
    expect(
      patchOf(opened, {
        ...opened,
        container: { capacity: 10, is_closed: false }
      })
    ).toEqual({
      put: { container: { capacity: 10, is_closed: false } },
      remove: []
    });
  });

  test('sends a cleared text field empty, and keeps a number left empty', () => {
    expect(
      patchOf(opened, {
        ...opened,
        described: { ...opened.described, description: '' },
        item: { is_takeable: true, weight: null }
      })
    ).toEqual({ put: { described: { description: '' } }, remove: [] });
  });
});
