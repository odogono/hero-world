import { describe, expect, test } from 'bun:test';

import { ChangeConflictError, createWorld } from '..';
import { defineComponent, s } from '../../component';

const statsComponent = defineComponent({
  id: 'statsChangeTest',
  schema: { health: s.number() }
});

const setup = async () => {
  const world = await createWorld([statsComponent]);
  const { id } = world.create({ statsChangeTest: { health: 100 } });
  world.flush();
  const proxy = () =>
    world.query({
      asProxy: true,
      entity: { id, world },
      maybe: ['statsChangeTest']
    })! as { statsChangeTest?: { health: number } | null };
  const health = () =>
    world.query({ entity: { id, world }, with: ['statsChangeTest'] })
      ?.statsChangeTest?.health;
  return { health, id, proxy, world };
};

describe('change scopes', () => {
  test('a discarded scope leaves no trace', async () => {
    const { health, proxy, world } = await setup();
    const scope = world.openChanges();
    scope.run(() => {
      proxy().statsChangeTest!.health = 10;
    });
    expect(health()).toBe(10);

    scope.discard();
    world.flush();

    expect(health()).toBe(100);
  });

  test('a committed scope is flushed', async () => {
    const { health, proxy, world } = await setup();
    const scope = world.openChanges();
    scope.run(() => {
      proxy().statsChangeTest = { health: 20 };
    });
    scope.commit();
    world.flush();

    expect(health()).toBe(20);
  });

  test('flush leaves an open scope pending', async () => {
    const { health, proxy, world } = await setup();
    const scope = world.openChanges();
    scope.run(() => {
      proxy().statsChangeTest!.health = 30;
    });
    world.flush();
    expect(
      world.db.query(
        `SELECT health FROM ${world.defs.get('statsChangeTest')!.tableName}`
      )
    ).toEqual([{ health: 100 }]);

    scope.commit();
    world.flush();
    expect(
      world.db.query(
        `SELECT health FROM ${world.defs.get('statsChangeTest')!.tableName}`
      )
    ).toEqual([{ health: 30 }]);
  });

  test('discard keeps changes made before the scope', async () => {
    const { health, proxy, world } = await setup();
    proxy().statsChangeTest!.health = 50;
    const scope = world.openChanges();
    scope.run(() => {
      proxy().statsChangeTest!.health = 40;
    });
    scope.discard();
    world.flush();

    expect(health()).toBe(50);
  });

  test('discard restores removed components and deleted entities', async () => {
    const { health, id, proxy, world } = await setup();
    const scope = world.openChanges();
    scope.run(() => {
      proxy().statsChangeTest = null;
      world.delete({ id });
    });
    scope.discard();
    world.flush();

    expect(world.get(id)).not.toBeNull();
    expect(health()).toBe(100);
  });

  test('discard removes entities created in the scope', async () => {
    const { world } = await setup();
    const scope = world.openChanges();
    const created = scope.run(() =>
      world.create({ statsChangeTest: { health: 1 } })
    );
    scope.discard();
    world.flush();

    expect(world.get(created.id)).toBeNull();
  });

  test('another scope cannot write an entity an open scope holds', async () => {
    const { proxy, world } = await setup();
    const first = world.openChanges();
    first.run(() => {
      proxy().statsChangeTest!.health = 1;
    });

    expect(() =>
      world.openChanges().run(() => {
        proxy().statsChangeTest!.health = 2;
      })
    ).toThrow(ChangeConflictError);
    expect(() => {
      proxy().statsChangeTest!.health = 3;
    }).toThrow(ChangeConflictError);

    first.commit();
    proxy().statsChangeTest!.health = 4;
  });
});
