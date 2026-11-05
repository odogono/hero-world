import { describe, expect, it } from 'bun:test';

import type { CDef, Components } from '../../types';
import type { World } from '../../world';
import {
  serializeComponentDef,
  serializeEDL,
  serializeEntity
} from '../serialize';

describe('serializeEntity', () => {
  it('serializes an entity with basic components', () => {
    const entity = {
      container: {
        capacity: 10,
        is_closed: false
      },
      described: {
        description: 'A test entity',
        name: 'Test Entity'
      },
      id: 1,
      world: {} as World<Components>
    };

    const result = serializeEntity(entity);

    expect(result).toBe(`entity entity_1 {
  container { capacity: 10 is_closed: false }
  described { description: "A test entity" name: "Test Entity" }
}`);
  });

  it('keeps keys as written', () => {
    const entity = {
      id: 3,
      link: { targetId: 1 },
      world: {} as World<Components>
    };

    expect(serializeEntity(entity)).toBe(`entity entity_3 {
  link { targetId: 1 }
}`);
  });

  it('orders properties and formats nested values', () => {
    const entity = {
      id: 42,
      stats: {
        active: true,
        config: { enabled: true, level: 2 },
        count: 5,
        note: null,
        rate: 3.14,
        tags: ['a', 'b', 'c']
      },
      world: {} as World<Components>
    };

    const result = serializeEntity(entity);

    expect(result).toBe(`entity entity_42 {
  stats { active: true config: {enabled: true level: 2} count: 5 note: null rate: 3.14 tags: ["a", "b", "c"] }
}`);
  });

  it('uses custom name when provided', () => {
    const entity = {
      id: 123,
      item: {
        weight: 1.5
      },
      world: {} as World<Components>
    };

    const result = serializeEntity(entity, 'my_item');

    expect(result).toBe(`entity my_item {
  item { weight: 1.5 }
}`);
  });

  it('handles references and string escaping', () => {
    const entity = {
      id: 7,
      location: {
        in: '$room_1'
      },
      notes: {
        text: 'Line 1\n"quoted"'
      },
      world: {} as World<Components>
    };

    const result = serializeEntity(entity);

    const expected = [
      'entity entity_7 {',
      '  location { in: $room_1 }',
      String.raw`  notes { text: "Line 1\n\"quoted\"" }`,
      '}'
    ].join('\n');

    expect(result).toBe(expected);
  });

  it('throws when encountering unsupported values', () => {
    const entity = {
      id: 8,
      script: {
        run: () => {}
      },
      world: {} as World<Components>
    };

    expect(() => serializeEntity(entity)).toThrow('Cannot serialize function');
  });
});

describe('serializeComponentDef', () => {
  it('serializes component definitions with defaults and flags', () => {
    const def: CDef = {
      columns: [
        { name: 'id', optional: false, type: 'pk' },
        { default: 'Anonymous', name: 'display_name', type: 'string' },
        { isUnique: true, name: 'email', optional: false, type: 'string' },
        {
          default: { mode: 'auto' } as unknown as string,
          name: 'settings',
          type: 'json'
        }
      ],
      hash: 'hash',
      id: 'user_profile'
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
      columns: [{ name: 'name', type: 'string' }],
      hash: 'hash',
      id: 'thing'
    };

    const entity = {
      id: 21,
      thing: {
        name: 'Widget'
      },
      world: {} as World<Components>
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
