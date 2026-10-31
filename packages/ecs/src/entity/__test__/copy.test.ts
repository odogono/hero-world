import { describe, expect, it } from 'bun:test';
import { deleteTempFile, makeTempFile } from 'odgn-helpers/file';

import { defineComponent, s } from '@component';
import { DatabaseType } from '@db';
import { createWorld } from '@world';

const worldOpts = {
  clearExisting: true,
  dbType: (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN,
  path: ':memory:'
};

describe('Entity', () => {
  describe('copy', () => {
    it('should copy an entities components and data', async () => {
      const path = makeTempFile();
      const opts = { ...worldOpts, clearExisting: false, path };

      const nameComponent = defineComponent({
        id: 'name',
        schema: {
          nickname: s.string()
        }
      });
      const world = await createWorld([nameComponent], opts);
      const entity = world.create({
        name: { nickname: 'test' }
      });

      const entity2 = world.create();

      // Ensure source data is in the DB for SQL-based copy
      world.flush();

      world.copy(entity, entity2);

      // Re-query the target from DB to observe copied components
      const refreshed = world.query({
        args: [entity2.id],
        where: 'e.id = ?',
        with: ['name']
      });

      expect(refreshed!.name!.nickname).toBe('test');

      world.close();
      deleteTempFile(path);
    });

    it('should copy an entity outside of cache', async () => {
      const path = makeTempFile();
      const opts = { ...worldOpts, clearExisting: false, path };
      const nameComponent = defineComponent({
        id: 'name',
        schema: {
          nickname: s.string()
        }
      });
      const statsComponent = defineComponent({
        id: 'stats',
        schema: {
          health: s.int()
        }
      });
      const world = await createWorld([nameComponent, statsComponent], opts);
      const entity = world.create({
        name: { nickname: 'test' }
      });
      const entity2 = world.create({
        stats: { health: 100 }
      });
      world.flush();
      world.close();

      const anotherWorld = await createWorld(
        [nameComponent, statsComponent],
        opts
      );
      anotherWorld.copy(entity.id, entity2.id);

      // Query the target entity to verify components were copied
      const queriedTarget = anotherWorld.query({
        args: [entity2.id],
        where: 'e.id = ?',
        with: ['name', 'stats']
      });
      expect(queriedTarget).toBeDefined();
      expect(queriedTarget!.name!.nickname).toBe('test');
      expect(queriedTarget!.stats!.health).toBe(100);

      // Modify copied target and persist
      queriedTarget!.stats!.health = 200;
      anotherWorld.flush();

      // Verify names on both entities (copy is one-directional)
      const nameEntities = anotherWorld.queryAll({ with: ['name'] });
      const nicknames = nameEntities.map(e => e!.name!.nickname).sort();
      expect(nicknames).toEqual(['test', 'test']);

      // Verify only the target has stats and it was updated
      const statEntities = anotherWorld.queryAll({ with: ['stats'] });
      const healths = statEntities.map(e => e!.stats!.health).sort();
      expect(healths).toEqual([200]);

      anotherWorld.close();

      deleteTempFile(path);
    });
  });
});
