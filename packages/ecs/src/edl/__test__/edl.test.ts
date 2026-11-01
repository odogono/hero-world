/* eslint-disable perfectionist/sort-objects */
import { describe, expect, it, mock } from 'bun:test';

import { defineComponent, s } from '@component';
import {
  EDLErrorCodes,
  EDLExecutionError,
  EDLMissingPropertyError,
  EDLUnknownEntityReferenceError,
  executeEDL,
  parseEDL
} from '@edl';
import { createWorld } from '@world';

const describedComponent = defineComponent({
  id: 'described',
  schema: {
    name: s.string(),
    description: s.string()
  }
});

const thingComponent = defineComponent({
  id: 'thing',
  schema: {
    size: s.number(),
    weight: s.number()
  }
});

const linkComponent = defineComponent({
  id: 'link',
  schema: {
    targetId: s.entityId()
  }
});

const statsArrayComponent = defineComponent({
  id: 'stats_array_test',
  schema: {
    items: s.array('int')
  }
});

describe('Entity Definition Language', () => {
  describe('parsing', () => {
    it('should parse a single line edl', () => {
      const edl =
        'atom chest { described { name: "Chest" description: "A simple wooden chest." } }';
      const parsed = parseEDL(edl);
      expect(parsed).toEqual([
        {
          type: 'atom',
          id: 'chest',
          components: {
            described: { name: 'Chest', description: 'A simple wooden chest.' }
          }
        }
      ]);
    });

    it('should parse an empty entity', () => {
      const edl = 'entity {}';
      const parsed = parseEDL(edl);
      expect(parsed).toEqual([
        { type: 'entity', id: undefined, components: {} }
      ]);
    });

    it('should parse a named entity', () => {
      const edl =
        'atom "mysterious thing" {} entity "unknown thing" : "mysterious thing" {}';
      const parsed = parseEDL(edl);
      expect(parsed).toEqual([
        { type: 'atom', id: 'mysterious thing', components: {} },
        {
          type: 'entity',
          id: 'unknown thing',
          components: {},
          extends: ['mysterious thing']
        }
      ]);
    });

    it('should parse entity references', () => {
      const edl = `
      entity parent {
        thing { size: 10 weight: 20 }
      }
      entity child {
        parent { id: $parent }
      }
      `;

      expect(parseEDL(edl)).toEqual([
        {
          type: 'entity',
          id: 'parent',
          components: { thing: { size: 10, weight: 20 } }
        },
        {
          type: 'entity',
          id: 'child',
          components: { parent: { id: '$parent' } }
        }
      ]);
    });

    it('should parse EDL', async () => {
      const edl = `
# atoms are not instantiated, they are used as templates for entities
atom chest {
  described {
    name: "Chest"
    description: "A simple wooden chest."
  }
  thing {
    size: 10
    weight: 20
  }
  container {
    capacity: 50
    is_closed: false
  }
}

# entity will instantiate an entity, using the chest atom as a template
entity lockable_chest: chest {
  lockable {
    is_locked: false
    key: "brass_key"
  }
  container {
    is_closed: true
  }
}
  `;

      const parsed = parseEDL(edl);

      expect(parsed).toEqual([
        {
          type: 'atom',
          id: 'chest',
          components: {
            described: { name: 'Chest', description: 'A simple wooden chest.' },
            thing: { size: 10, weight: 20 },
            container: { capacity: 50, isClosed: false }
          }
        },
        {
          type: 'entity',
          id: 'lockable_chest',
          extends: ['chest'],
          components: {
            lockable: { isLocked: false, key: 'brass_key' },
            container: { isClosed: true }
          }
        }
      ]);
    });

    it('should handle multiple inheritance', () => {
      const edl = `
      atom chest_described { described { name: "Chest" description: "A simple wooden chest." } }
      atom chest_thing { thing { size: 10 weight: 20 } }

      entity chest: 
        chest_described 
        chest_thing 
        {}
      `;

      const parsed = parseEDL(edl);

      expect(parsed).toEqual([
        {
          type: 'atom',
          id: 'chest_described',
          components: {
            described: { name: 'Chest', description: 'A simple wooden chest.' }
          }
        },
        {
          type: 'atom',
          id: 'chest_thing',
          components: { thing: { size: 10, weight: 20 } }
        },
        {
          type: 'entity',
          id: 'chest',
          extends: ['chest_described', 'chest_thing'],
          components: {}
        }
      ]);
    });

    it('should handle atom inheritence', async () => {
      const edl = `
      atom base { thing { size: 10 weight: 20 } }
      atom child: base { thing { size: 15 } }

      entity chest: child {}
      `;

      const parsed = parseEDL(edl);

      expect(parsed).toEqual([
        {
          type: 'atom',
          id: 'base',
          components: { thing: { size: 10, weight: 20 } }
        },
        {
          type: 'atom',
          id: 'child',
          extends: ['base'],
          components: { thing: { size: 15 } }
        },
        {
          type: 'entity',
          extends: ['child'],
          components: {},
          id: 'chest'
        }
      ]);

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const entity = world.query({ with: ['thing'] })!;
      expect(entity.thing!.size).toBe(15);
      expect(entity.thing!.weight).toBe(20);
    });

    it('should parse a component definition', () => {
      const edl = `
        def user {
          name: string null
          email: email not null is_unique
          age: int default 0
          height: float default 0.0
          linked: eid
          is_active: boolean default true
          created_at: datetime default current_timestamp
        }
      `;

      const parsed = parseEDL(edl);

      expect(parsed).toEqual([
        {
          type: 'component',
          id: 'user',
          columns: [
            { name: 'name', type: 'string' },
            { name: 'email', type: 'email', optional: false, isUnique: true },
            { name: 'age', type: 'int', default: '0' },
            { name: 'height', type: 'float', default: '0.0' },
            { name: 'linked', type: 'eid' },
            { name: 'is_active', type: 'boolean', default: 'true' },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'current_timestamp'
            }
          ]
        }
      ]);
    });

    it('should parse JSON values', () => {
      const edl = `
      def user {
        props: json default { "name": "John", "age": 30 }
      }

      entity anon {
        user { props: { name: "Jane", age: 25, favs: [1, 2, 3] } }
      }
      `;

      const parsed = parseEDL(edl);

      expect(parsed).toEqual([
        {
          type: 'component',
          id: 'user',
          columns: [
            { name: 'props', type: 'json', default: { name: 'John', age: 30 } }
          ]
        },
        {
          type: 'entity',
          id: 'anon',
          components: {
            user: { props: { name: 'Jane', age: 25, favs: [1, 2, 3] } }
          }
        }
      ]);
    });
  });

  describe('execution', () => {
    it('should create an entity with a contained component', async () => {
      const edl = `
      entity chest {
        thing { size: 10 weight: 20 }
      }
      `;

      const world = await createWorld([thingComponent]);

      executeEDL(world, edl);

      const entity = world.query({ with: ['thing'] })!;

      expect(entity).toBeDefined();
      expect(entity.thing.size).toBe(10);
      expect(entity.thing.weight).toBe(20);
    });

    it('should resolve $name to an entity id', async () => {
      const edl = `
      entity parent {
        thing { size: 10 weight: 20 }
      }
      entity child {
        link { target_id: $parent }
      }
      `;

      const world = await createWorld([thingComponent, linkComponent]);

      executeEDL(world, edl);

      const parent = world.query({ with: ['thing'] })!;
      const child = world.query({ with: ['link'] })!;

      expect(child.link.targetId).toBe(parent.id);
    });

    it('should resolve $name.component.value to the referenced value', async () => {
      const edl = `
      entity parent {
        thing { size: 10 weight: 20 }
      }
      entity child {
        thing { size: $parent.thing.size weight: 5 }
      }
      `;

      const world = await createWorld([thingComponent]);

      executeEDL(world, edl);

      const parent = world.query({
        with: ['thing'],
        where: 'thing_weight = 20'
      })!;
      const child = world.query({
        with: ['thing'],
        where: 'thing_weight = 5'
      })!;

      expect(child.thing.size).toBe(parent.thing.size);
      expect(child.thing.weight).toBe(5);
    });

    it('should support forward references', async () => {
      const edl = `
      entity child {
        link { target_id: $parent }
      }
      entity parent {
        thing { size: 10 weight: 20 }
      }
      `;

      const world = await createWorld([thingComponent, linkComponent]);

      executeEDL(world, edl);

      const parent = world.query({ with: ['thing'] })!;
      const child = world.query({ with: ['link'] })!;

      expect(child.link.targetId).toBe(parent.id);
    });

    it('should throw error when component defines reserved column', async () => {
      const edl = `def bad { id: string }`;

      await expect(createWorld(edl)).rejects.toThrow(
        "Component 'bad' cannot define reserved column 'id'."
      );
    });

    it('should throw on unknown entity reference', async () => {
      const edl = `
      entity child { link { target_id: $missing } }
      `;

      const world = await createWorld([linkComponent]);

      try {
        executeEDL(world, edl);
        throw new Error('Expected executeEDL to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EDLExecutionError);
        const e = error as EDLExecutionError;
        expect(
          e.errors.some(x => x instanceof EDLUnknownEntityReferenceError)
        ).toBe(true);
        expect(e.code).toBe(EDLErrorCodes.EDL_EXECUTION_ERROR);
      }
    });

    it('should throw on missing component property path', async () => {
      const edl = `
      entity parent { thing { size: 10 weight: 20 } }
      entity child { thing { size: $parent.thing.missing weight: 5 } }
      `;

      const world = await createWorld([thingComponent]);

      try {
        executeEDL(world, edl);
        throw new Error('Expected executeEDL to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EDLExecutionError);
        const e = error as EDLExecutionError;
        expect(e.errors.some(x => x instanceof EDLMissingPropertyError)).toBe(
          true
        );
        expect(e.code).toBe(EDLErrorCodes.EDL_EXECUTION_ERROR);
      }
    });

    it('should resolve array index in reference paths', async () => {
      const edl = `
      entity parent { stats_array_test { items: [10, 20, 30] } }
      entity child { thing { size: $parent.stats_array_test.items.1 weight: 5 } }
      `;

      const world = await createWorld([thingComponent, statsArrayComponent]);
      executeEDL(world, edl);

      const child = world.query({
        with: ['thing'],
        where: 'thing_weight = 5'
      })!;
      expect(child.thing.size).toBe(20);
      expect(child.thing.weight).toBe(5);
    });

    it('should inherit components from an atom', async () => {
      const edl = `
      atom template { thing { size: 7 weight: 9 } }
      entity item: template {}
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const inherited = world.query({
        with: ['thing'],
        where: 'thing_size = 7 AND thing_weight = 9'
      });

      expect(inherited).not.toBeNull();
    });

    it('should inherit from multiple atoms with rightmost precedence', async () => {
      const edl = `
      atom base1 { thing { size: 1 weight: 2 } }
      atom base2 { thing { size: 10 } }
      entity combined: base1 base2 {}
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const e = world.query({
        with: ['thing'],
        where: 'thing_size = 10 AND thing_weight = 2'
      });

      expect(e).not.toBeNull();
    });

    it('should reject an entity extending an entity', async () => {
      const edl = `
      entity base { thing { size: 3 weight: 4 } }
      entity child: base { thing { weight: 8 } }
      `;

      const world = await createWorld([thingComponent]);
      expect(() => executeEDL(world, edl)).toThrow(
        /'child' cannot extend 'base': only atoms may be extended/
      );
    });

    it('should reject an atom extending an entity', async () => {
      const edl = `
      entity base { thing { size: 3 weight: 4 } }
      atom child: base {}
      `;

      const world = await createWorld([thingComponent]);
      expect(() => executeEDL(world, edl)).toThrow(
        /only atoms may be extended/
      );
    });

    it('should keep Lineage for entities and atoms after loading', async () => {
      const edl = `
      atom base { thing { size: 1 weight: 2 } }
      atom heavy: base { thing { weight: 50 } }
      atom big { thing { size: 99 } }
      entity rock: heavy big {}
      entity pebble { thing { size: 1 weight: 1 } }
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const rock = world.query({ with: ['thing'], where: 'thing_size = 99' })!;
      expect(rock.thing.weight).toBe(50);
      expect(world.getEntityLineage(rock.id)).toEqual(['heavy', 'big']);

      const pebble = world.query({
        with: ['thing'],
        where: 'thing_size = 1'
      })!;
      expect(world.getEntityLineage(pebble.id)).toEqual([]);

      expect(world.getAtomLineage('heavy')).toEqual(['base']);
      expect(world.getAtomLineage('base')).toEqual([]);
      expect(world.getAtomLineage('missing')).toBeUndefined();

      // atoms never become entities
      expect(world.queryAll({ with: ['thing'] })).toHaveLength(2);
    });

    it('should throw on circular value references', async () => {
      const edl = `
      entity a { thing { size: $b.thing.size weight: 1 } }
      entity b { thing { size: $a.thing.size weight: 2 } }
      `;

      const world = await createWorld([thingComponent]);

      expect(() => executeEDL(world, edl)).toThrow(/circular reference/i);
    });

    it('should throw on circular inheritance', async () => {
      const edl = `
      atom a: b {}
      atom b: a {}
      `;

      const world = await createWorld([]);
      try {
        executeEDL(world, edl);
        throw new Error('Expected executeEDL to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(EDLExecutionError);
        const e = error as EDLExecutionError;
        expect(e.errors.length).toBeGreaterThan(0);
        expect(e.code).toBe(EDLErrorCodes.EDL_EXECUTION_ERROR);
      }
    });
  });

  describe('commands', () => {
    it('should set component properties', async () => {
      const edl = `
      entity chest {
        thing { size: 10 weight: 20 }
      }
      !set $chest.thing.size 30
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const chest = world.query({
        with: ['thing'],
        where: 'thing_size = 30'
      })!;
      expect(chest.thing.size).toBe(30);
      expect(chest.thing.weight).toBe(20);
    });

    it('should add a component with !set', async () => {
      const edl = `
      entity chest {}

      # the !set command adds the thing component to the chest entity
      # and sets the weight property to 40
      !set $chest.thing.weight 40
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const chest = world.query({
        with: ['thing'],
        where: 'thing_weight = 40'
      })!;
      expect(chest.thing.weight).toBe(40);
    });

    it('should allow arbitrary commands', async () => {
      const edl = `
      entity chest {
        thing { size: 10 weight: 20 }
      }
      #commands start with a ! and are executed in the order they appear
      !examine $chest.thing.weight $chest arg_1 13 true "a medium sized chest" $chest.thing.id
      `;

      const examine = mock((..._args: unknown[]) => {});

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl, { commands: { '!examine': examine } });

      const chest = world.query({
        with: ['thing'],
        where: 'thing_weight = 20'
      })!;

      expect(examine.mock.calls).toEqual([
        [20, chest.id, 'arg_1', 13, true, 'a medium sized chest', 1]
      ]);
    });

    it('should resolve component existence for commands', async () => {
      const edl = `
      entity chest {}
      !examine $chest.thing._exists
    `;

      const examine = mock((..._args: unknown[]) => {});
      const world = await createWorld([thingComponent]);
      executeEDL(world, edl, { commands: { '!examine': examine } });

      expect(examine.mock.calls).toEqual([[false]]);
    });

    it('should resolve component row id for commands', async () => {
      const edl = `
      entity chest { thing { size: 1 weight: 2 } }
      !examine $chest.thing.id $chest._count
    `;

      const examine = mock((..._args: unknown[]) => {});
      const world = await createWorld([thingComponent]);
      world.executeEDL(edl, { commands: { '!examine': examine } });

      const chest = world.query({ with: ['thing'] })!;
      expect(chest).toBeDefined();
      expect(examine.mock.calls).toEqual([[1, 1]]); // i don't really know why this is important
    });

    it('should handle optional properties', async () => {
      const edl = `

      entity room {
        thing { size: 10 weight: 20 }
      }

      entity door_one {
        portal { to: $room }
      }
        
      entity door_two {
        portal { msg: "The door is locked" }
      }
      `;

      const portalDef = defineComponent({
        id: 'portal',
        schema: {
          to: s.entityId().optional(),
          msg: s.string().optional()
        }
      });

      const world = await createWorld([thingComponent, portalDef]);
      world.executeEDL(edl);

      const thing = world.query({ with: ['thing'] })!;
      expect(thing.thing!.size).toBe(10);

      const doors = world.queryAll({ with: ['portal'] });
      expect(doors).toHaveLength(2);
      expect(doors[0]!.portal!.to).toBe(thing.id);
      expect(doors[1]!.portal!.msg).toBe('The door is locked');
    });
  });
});
