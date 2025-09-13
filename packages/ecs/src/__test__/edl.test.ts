/* eslint-disable perfectionist/sort-objects */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';

import { executeEDL, parseEDL } from '../edl';
import {
  EDLErrorCodes,
  EDLExecutionError,
  EDLMissingComponentError,
  EDLMissingPropertyError,
  EDLUnknownEntityReferenceError
} from '../edl';
import { queryEntity } from '../entity';
import { withEntityId } from '../schema';
import { createWorld } from '../world';

const describedComponent = defineComponent({
  name: 'described',
  schema: {
    name: z.string(),
    description: z.string()
  }
});

const thingComponent = defineComponent({
  name: 'thing',
  schema: {
    size: z.number(),
    weight: z.number()
  }
});

const containerComponent = defineComponent({
  name: 'container',
  schema: {
    capacity: z.number(),
    isClosed: z.boolean()
  }
});

const lockableComponent = defineComponent({
  name: 'lockable',
  schema: {
    isLocked: z.boolean(),
    key: z.string()
  }
});

const containedComponent = defineComponent({
  name: 'contained',
  schema: {
    id: withEntityId()
  }
});

const linkComponent = defineComponent({
  name: 'link',
  schema: {
    targetId: withEntityId()
  }
});

const statsArrayComponent = defineComponent({
  name: 'stats_array_test',
  schema: {
    items: z.array(z.number())
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
      // const world = await createWorld([
      //   describedComponent,
      //   thingComponent,
      //   containerComponent,
      //   lockableComponent
      // ]);

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

      const entity = queryEntity(world, { with: ['thing'] })!;

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

      const parent = queryEntity(world, { with: ['thing'] })!;
      const child = queryEntity(world, { with: ['link'] })!;

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

      const parent = queryEntity(world, { with: ['thing'], where: 'thing_weight = 20' })!;
      const child = queryEntity(world, { with: ['thing'], where: 'thing_weight = 5' })!;

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

      const parent = queryEntity(world, { with: ['thing'] })!;
      const child = queryEntity(world, { with: ['link'] })!;

      expect(child.link.targetId).toBe(parent.id);
    });

    it('should throw on unknown entity reference', async () => {
      const edl = `
      entity child { link { target_id: $missing } }
      `;

      const world = await createWorld([linkComponent]);

      try {
        executeEDL(world, edl);
        throw new Error('Expected executeEDL to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(EDLExecutionError);
        const e = err as EDLExecutionError;
        expect(e.errors.some(x => x instanceof EDLUnknownEntityReferenceError)).toBe(true);
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
      } catch (err) {
        expect(err).toBeInstanceOf(EDLExecutionError);
        const e = err as EDLExecutionError;
        expect(e.errors.some(x => x instanceof EDLMissingPropertyError)).toBe(true);
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

      const child = queryEntity(world, { with: ['thing'], where: 'thing_weight = 5' })!;
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

      const inherited = queryEntity(world, {
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

      const e = queryEntity(world, {
        with: ['thing'],
        where: 'thing_size = 10 AND thing_weight = 2'
      });

      expect(e).not.toBeNull();
    });

    it('should inherit from an entity and allow overrides', async () => {
      const edl = `
      entity base { thing { size: 3 weight: 4 } }
      entity child: base { thing { weight: 8 } }
      `;

      const world = await createWorld([thingComponent]);
      executeEDL(world, edl);

      const child = queryEntity(world, {
        with: ['thing'],
        where: 'thing_weight = 8'
      })!;

      expect(child.thing.size).toBe(3);
      expect(child.thing.weight).toBe(8);
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
      entity a: b {}
      entity b: a {}
      `;

      const world = await createWorld([]);
      try {
        executeEDL(world, edl);
        throw new Error('Expected executeEDL to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(EDLExecutionError);
        const e = err as EDLExecutionError;
        expect(e.errors.length).toBeGreaterThan(0);
        expect(e.code).toBe(EDLErrorCodes.EDL_EXECUTION_ERROR);
      }
    });
  });
});
