import { describe, expect, it } from 'bun:test';

import type { CDef } from '@types';

import {
  serializeComponentDef,
  serializeEDL,
  serializeEntity
} from '../serialize';

describe('serializeEntity', () => {
  it('serializes an entity with basic components', () => {
    const entity = {
      id: 1,
      world: {} as any,
      described: {
        name: 'Test Entity',
        description: 'A test entity'
      },
      container: {
        capacity: 10,
        isClosed: false
      }
    };

    const result = serializeEntity(entity);

    expect(result).toBe(`entity entity_1 {
  container { capacity: 10 is_closed: false }
  described { description: "A test entity" name: "Test Entity" }
}`);
  });

  it('orders properties and formats nested values', () => {
    const entity = {
      id: 42,
      world: {} as any,
      stats: {
        count: 5,
        active: true,
        rate: 3.14,
        tags: ['a', 'b', 'c'],
        config: { enabled: true, level: 2 },
        note: null
      }
    };

    const result = serializeEntity(entity);

    expect(result).toBe(`entity entity_42 {
  stats { active: true config: {enabled: true level: 2} count: 5 note: null rate: 3.14 tags: ["a", "b", "c"] }
}`);
  });

  it('uses custom name when provided', () => {
    const entity = {
      id: 123,
      world: {} as any,
      item: {
        weight: 1.5
      }
    };

    const result = serializeEntity(entity, 'my_item');

    expect(result).toBe(`entity my_item {
  item { weight: 1.5 }
}`);
  });

  it('handles references and string escaping', () => {
    const entity = {
      id: 7,
      world: {} as any,
      location: {
        in: '$room_1'
      },
      notes: {
        text: 'Line 1\n"quoted"'
      }
    };

    const result = serializeEntity(entity);

    const expected = [
      'entity entity_7 {',
      '  location { in: $room_1 }',
      '  notes { text: "Line 1\\n\\"quoted\\"" }',
      '}'
    ].join('\n');

    expect(result).toBe(expected);
  });

  it('throws when encountering unsupported values', () => {
    const entity = {
      id: 8,
      world: {} as any,
      script: {
        run: () => {}
      }
    };

    expect(() => serializeEntity(entity)).toThrow('Cannot serialize function');
  });
});

describe('serializeComponentDef', () => {
  it('serializes component definitions with defaults and flags', () => {
    const def: CDef = {
      id: 'UserProfile',
      hash: 'hash',
      columns: [
        { name: 'id', type: 'pk', optional: false },
        { name: 'displayName', type: 'string', default: 'Anonymous' },
        { name: 'email', type: 'string', optional: false, isUnique: true },
        {
          name: 'settings',
          type: 'json',
          default: { mode: 'auto' } as unknown as string
        }
      ]
    };

    expect(serializeComponentDef(def)).toBe(`def user_profile {
  id: pk not null
  display_name: string null default Anonymous
  email: string not null is_unique
  settings: json null default {"mode":"auto"}
}`);
  });
});

describe('serializeEDL', () => {
  it('serializes component definitions and entities together', () => {
    const def: CDef = {
      id: 'Thing',
      hash: 'hash',
      columns: [{ name: 'name', type: 'string' }]
    };

    const entity = {
      id: 21,
      world: {} as any,
      thing: {
        name: 'Widget'
      }
    };

    expect(
      serializeEDL({
        componentDefs: [def],
        entities: [{ entity, name: 'widget_entity' }]
      })
    ).toBe(`def thing {
  name: string null
}

entity widget_entity {
  thing { name: "Widget" }
}`);
  });
});
