/* eslint-disable perfectionist/sort-objects */
import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { defineComponent } from '@component';

import { parseEDL } from '../edl';

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
});
