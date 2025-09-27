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

      world.copy(entity, entity2);

      expect(entity2.name!.nickname).toBe('test');

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
      const clonedEntity = anotherWorld.copy(entity.id, entity2.id);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.name!.nickname).toBe('test');
      expect(clonedEntity.stats!.health).toBe(100);
      clonedEntity.stats!.health = 200;
      anotherWorld.flush();

      const entities = anotherWorld.queryAll({ with: ['name', 'stats'] });
      const nicknames = entities.map(e => e!.name!.nickname).sort();
      const healths = entities.map(e => e!.stats!.health).sort();
      expect(nicknames).toEqual(['test', 'test']);
      expect(healths).toEqual([100, 200]);

      anotherWorld.close();

      deleteTempFile(path);
    });
  });
});
