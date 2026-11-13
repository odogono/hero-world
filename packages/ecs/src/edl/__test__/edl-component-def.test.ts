import { describe, expect, it } from 'bun:test';

import { parseEDL } from '..';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';

// An included file that declares a component
const readDefs = (file: string) => {
  if (file !== '/game/defs.edl') {
    throw new Error('no such file');
  }
  return 'def tide {\n  high: boolean default false\n}';
};

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

  it('defines the components it declares when a World is built from it, in an include too', async () => {
    const world = await createWorld([], {
      path: ':memory:',
      type: DatabaseType.BUN
    });
    world.executeEDL('include "defs.edl"\nentity sea { tide { high: true } }', {
      path: '/game/main.edl',
      readFile: readDefs
    });
    // the World was made with no components, so its types know none
    const [sea] = world.queryAll({ with: ['tide' as never] }) as unknown as {
      tide?: unknown;
    }[];

    expect(world.defs.has('tide')).toBe(true);
    expect(sea?.tide).toEqual({ high: true });
  });
});
