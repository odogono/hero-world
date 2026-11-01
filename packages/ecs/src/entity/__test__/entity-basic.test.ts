import { describe, expect, expectTypeOf, test } from 'bun:test';

import { defineComponent, s } from '@component';

import { createWorld } from '../../world';

describe('Entity Basic', () => {
  test('should create entity with components', async () => {
    const positionDef = defineComponent({
      id: 'position',
      schema: {
        x: s.number().default(0),
        y: s.number().default(0),
        z: s.number().default(0)
      }
    });

    const statusDef = defineComponent({
      id: 'status',
      schema: {
        status: s.enum(['idle', 'walking', 'fighting', 'dead']).default('idle')
      }
    });

    const world = await createWorld([positionDef, statusDef] as const);

    const entity = world.create({
      position: {
        x: 10,
        y: 20,
        z: 30
      },
      status: {
        status: 'walking'
      }
    });

    expectTypeOf(entity.position.x).toEqualTypeOf<number>();
    expectTypeOf(entity.position.y).toEqualTypeOf<number>();
    expectTypeOf(entity.position.z).toEqualTypeOf<number>();
    expectTypeOf(entity.status.status).toEqualTypeOf<
      'idle' | 'walking' | 'fighting' | 'dead'
    >();

    expect(entity.position.x).toBe(10);
    expect(entity.position.y).toBe(20);
    expect(entity.position.z).toBe(30);
    expect(entity.status.status).toBe('walking');

    expect(entity).toBeDefined();
  });
});
