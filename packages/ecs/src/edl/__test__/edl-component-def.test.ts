import { describe, expect, it } from 'bun:test';

import { parseEDL } from '..';

describe('EDL Component Definitions', () => {
  it('should parse multiple component definitions mixed with atoms/entities', () => {
    const edl = `
      # component first
      def user {
        name: string null
        email: email not null is_unique
      }

      atom chest { described { name: "Chest" description: "A simple wooden chest." } }

      entity item: chest {}
    `;

    const parsed = parseEDL(edl);

    expect(parsed[0]).toEqual({
      columns: [
        { name: 'name', type: 'string' },
        { isUnique: true, name: 'email', optional: false, type: 'email' }
      ],
      id: 'user',
      type: 'component'
    });

    expect(parsed[1]).toEqual({
      components: {
        described: { description: 'A simple wooden chest.', name: 'Chest' }
      },
      id: 'chest',
      type: 'atom'
    });

    expect(parsed[2]).toEqual({
      components: {},
      extends: ['chest'],
      id: 'item',
      type: 'entity'
    });
  });

  it('should preserve default strings including quotes and spaces', () => {
    const edl = `
      def sample {
        note: string default "hello world" # inline comment
        flag: string default true
      }
    `;

    const parsed = parseEDL(edl);
    expect(parsed).toEqual([
      {
        columns: [
          { default: '"hello world"', name: 'note', type: 'string' },
          { default: 'true', name: 'flag', type: 'string' }
        ],
        id: 'sample',
        type: 'component'
      }
    ]);
  });
});
