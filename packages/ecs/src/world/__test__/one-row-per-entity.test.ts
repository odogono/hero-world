import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database as SqliteDatabase } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { createWorld } from '..';
import { defineComponent, s } from '../../component';

const stats = defineComponent({
  id: 'statsOneRow',
  schema: { health: s.number() }
});

describe('one row per entity in a component table', () => {
  test('a duplicate row fails to insert', async () => {
    const world = await createWorld([stats]);
    const { id } = world.create({ statsOneRow: { health: 1 } });
    world.flush();
    const table = world.defs.get('statsOneRow')!.tableName;

    expect(() =>
      world.db.exec(`INSERT INTO ${table} (eid, health) VALUES (${id}, 2)`)
    ).toThrow();
    world.close();
  });

  test('opening a world file keeps only the newest duplicate row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ecs-one-row-'));
    const path = join(dir, 'world.db');
    try {
      const world = await createWorld([stats], { path });
      const { id } = world.create({ statsOneRow: { health: 1 } });
      world.flush();
      const table = world.defs.get('statsOneRow')!.tableName;
      world.close();

      // Recreate a file written before the constraint existed
      const raw = new SqliteDatabase(path);
      raw.run(`DROP INDEX uidx_${table}_eid`);
      raw.run(`INSERT INTO ${table} (eid, health) VALUES (${id}, 2)`);
      raw.run(`INSERT INTO ${table} (eid, health) VALUES (${id}, 3)`);
      raw.close();

      const reopened = await createWorld([stats], { path });
      const rows = reopened.db
        .prepare(`SELECT health FROM ${table} WHERE eid = ${id}`)
        .all() as { health: number }[];
      expect(rows).toEqual([{ health: 3 }]);
      expect(
        reopened.query({
          entity: { id, world: reopened },
          with: ['statsOneRow']
        })?.statsOneRow?.health
      ).toBe(3);
      reopened.close();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
