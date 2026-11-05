import { describe, expect, it } from 'bun:test';

import { fromComponents, opposite, toDirection, words } from '../verbs';

const form = (handler: string, pattern: string) => ({ handler, pattern });
const veto = (event: string) => ({ about: 'target', asks: 'target', event });

describe('fromComponents', () => {
  it("tries a later Verb's forms first, keeping the earlier ones", () => {
    const vocabulary = fromComponents([
      { verbs: { defs: [{ forms: [form('look', '')], names: ['look'] }] } },
      {
        verbs: {
          defs: [{ forms: [form('lookUnder', 'under obj')], names: ['look'] }]
        }
      }
    ]);

    expect(vocabulary.byName.get('look')?.forms.map(f => f.handler)).toEqual([
      'lookUnder',
      'look'
    ]);
  });

  it('skips a malformed Verb or form', () => {
    const vocabulary = fromComponents([
      {
        verbs: {
          defs: [
            { forms: [form('a', '')], names: [] },
            { forms: [{ ...form('b', 'obj'), reach: 'far' }], names: ['b'] },
            'nonsense',
            { forms: [form('c', '')], names: ['C'] }
          ]
        }
      }
    ]);

    expect([...vocabulary.byName.keys()]).toEqual(['c']);
  });

  it('lets a later Direction replace an earlier one in its place', () => {
    const vocabulary = fromComponents([
      {
        words: {
          aliases: { N: 'North' },
          directions: [
            { name: 'north', opposite: 'south' },
            { name: 'south', opposite: 'north' }
          ]
        }
      },
      { words: { directions: [{ name: 'North', opposite: 'down' }] } }
    ]);

    expect(vocabulary.directions).toEqual([
      ['north', 'down'],
      ['south', 'north']
    ]);
    expect(toDirection(vocabulary, 'n')).toBe('north');
    expect(toDirection(vocabulary, 'east')).toBeNull();
    expect(opposite(vocabulary, 'north')).toBe('down');
  });

  it("keeps each handler's Vetoes, a later Verb's replacing earlier ones", () => {
    const vocabulary = fromComponents([
      {
        verbs: {
          defs: [
            {
              forms: [form('take', 'obj')],
              names: ['take'],
              vetoes: [veto('beforeTake')]
            },
            {
              forms: [form('take', 'up obj')],
              names: ['pick'],
              vetoes: [veto('beforePick')]
            }
          ]
        }
      }
    ]);

    expect(vocabulary.vetoes.get('take')).toEqual([veto('beforePick')]);
  });

  it('lists the words that start a command', () => {
    const vocabulary = fromComponents([
      {
        verbs: { defs: [{ forms: [form('look', '')], names: ['look', 'l'] }] },
        words: { aliases: { n: 'north' }, directions: [{ name: 'north' }] }
      }
    ]);

    expect(words(vocabulary)).toEqual([
      'look',
      'l',
      'north',
      'n',
      'again',
      'g'
    ]);
  });
});
