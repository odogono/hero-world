import { describe, expect, expectTypeOf, it } from 'bun:test';

import { defineComponent, s } from '../../component';
import { DatabaseType } from '../../db';
import { createWorld } from '../../world';

describe('World EDL', () => {
  it('should create a world with defs from edl', async () => {
    const edl = `
    def position {
      x: float default 0
      y: float default 0
      z: float default 0
    }

    def health {
      health: float default 100
      max: float default 100
    }
    `;

    const world = await createWorld(edl, {
      path: ':memory:',
      type: DatabaseType.BUN
    });

    const entity = world.create({
      health: {
        health: 50,
        max: 100
      },
      position: {
        x: 10,
        y: 20,
        z: 30
      }
    });

    // NOTE edl is runtime parsed, so the types are not inferred properly
    expectTypeOf(entity.position.x).not.toEqualTypeOf<number>();
    expectTypeOf(entity.position.y).not.toEqualTypeOf<number>();
    expectTypeOf(entity.position.z).not.toEqualTypeOf<number>();
    expectTypeOf(entity.health.health).not.toEqualTypeOf<number>();
    expectTypeOf(entity.health.max).not.toEqualTypeOf<number>();

    expect(entity.position.x).toBe(10);
    expect(entity.position.y).toBe(20);
    expect(entity.position.z).toBe(30);
    expect(entity.health.health).toBe(50);
    expect(entity.health.max).toBe(100);
  });

  it('should create a world from edl with entities', async () => {
    const edl = `
    def position {
      x: float default 0
      y: float default 0
      z: float default 0
    }

    def container {
      capacity: int default 10
      is_closed: boolean default false
    }

    def measured {
      area: float default 0
      weight: float default 0
    }

    atom container {
      container { capacity: 10 is_closed: false }
    }

    atom thing {
      measured { area: 10 weight: 20 }
    }

    entity box: thing container {
      position { x: 10 y: 20 z: 30 }
    }
    `;

    const world = await createWorld(edl, {
      path: ':memory:',
      type: DatabaseType.BUN
    });

    const box = world.query({ with: ['position', 'measured'] })!;
    expect(box.position.x).toBe(10);
    expect(box.position.y).toBe(20);
    expect(box.position.z).toBe(30);
    expect(box.measured.area).toBe(10);
    expect(box.measured.weight).toBe(20);

    // NOTE atoms are not saved as entities
    const data = world.saveToJSON({ asComponents: false });
    expect(data).toHaveLength(1);

    const allEntities = world.queryAll();
    expect(allEntities).toHaveLength(1);
  });

  it('should load and run edl on an existing world', async () => {
    const containerDef = defineComponent({
      id: 'container',
      schema: {
        capacity: s.number().default(10),
        isClosed: s.boolean().default(false)
      }
    });

    const world = await createWorld([containerDef], {
      path: ':memory:',
      type: DatabaseType.BUN
    });

    const edl = `
    entity box {
      container { capacity: 15 isClosed: true }
    }
    `;

    world.executeEDL(edl);

    const box = world.query({ with: ['container'] })!;

    expect(box.container!.capacity).toBe(15);
    expect(box.container!.isClosed).toBeTruthy();
  });
});
