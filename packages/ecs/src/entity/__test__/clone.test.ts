import { describe, expect, it, test } from 'bun:test';
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
  describe('sanity', () => {
    test('should create a world with a complex entity', async () => {
      const edl = `
    def name { nickname: string }
    def stats { health: int mana: int }
    def isSitting { sitting: bool }
    def inventory { items: json }
    def location { locationId: eid }
    `;

      const world = await createWorld(edl, worldOpts);
      world.create({
        inventory: { items: [{ id: 'sword', name: 'Sword' }] },
        isSitting: { sitting: true },
        location: { locationId: 1 },
        name: { nickname: 'conan' },
        stats: { health: 100, mana: 50 }
      });

      world.flush();

      const e = world.query({ with: ['name', 'inventory'] });
      expect(e.name.nickname).toBe('conan');
      expect(e.inventory.items).toEqual([{ id: 'sword', name: 'Sword' }]);

      // console.log(e);
      const fe = world.get(e.id);
      expect(fe.name).not.toBeDefined();
      expect(fe.inventory).not.toBeDefined();
    });
  });

  describe('clone', () => {
    it('should clone an entity', async () => {
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

      // console.debug('entity', entity);
      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.name!.nickname).toBe('test');
      expect(clonedEntity.id).not.toBe(entity.id);

      // change the original entity nickname and flush
      entity.name!.nickname = 'test2';
      world.flush();

      const entities = world.queryAll({ with: ['name'] });
      expect(entities).toHaveLength(2);
      const nicknames = entities.map(e => e!.name!.nickname).sort();
      expect(nicknames).toEqual(['test', 'test2']);
      world.close();

      // create a new world with the same db
      const anotherWorld = await createWorld([nameComponent], opts);

      // query entities which are not in the cache
      const entities2 = anotherWorld.queryAll({ with: ['name'] });
      expect(entities2).toHaveLength(2);
      const nicknames2 = entities2.map(e => e!.name!.nickname).sort();
      expect(nicknames2).toEqual(['test', 'test2']);

      anotherWorld.close();

      deleteTempFile(path);
    });

    it('should clone an entity outside of cache', async () => {
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
      world.flush();
      world.close();

      const anotherWorld = await createWorld([nameComponent], opts);
      const clonedEntity = anotherWorld.clone(entity.id);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.name!.nickname).toBe('test');
      expect(clonedEntity.id).not.toBe(entity.id);
      clonedEntity.name!.nickname = 'test2';
      anotherWorld.flush();

      const entities = anotherWorld.queryAll({ with: ['name'] });
      const nicknames = entities.map(e => e!.name!.nickname).sort();
      expect(nicknames).toEqual(['test', 'test2']);

      anotherWorld.close();

      deleteTempFile(path);
    });

    it('should clone entity with multiple components', async () => {
      const edl = `
      def position { x: float y: float z: float }
      def velocity { dx: float dy: float dz: float }
      def name { nickname: string }
      `;
      const world = await createWorld(edl, worldOpts);
      const entity = world.create({
        name: { nickname: 'original' },
        position: { x: 10, y: 20, z: 30 },
        velocity: { dx: 1, dy: 2, dz: 3 }
      });

      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.id).not.toBe(entity.id);
      expect(clonedEntity.position!.x).toBe(10);
      expect(clonedEntity.velocity!.dy).toBe(2);
      expect(clonedEntity.name!.nickname).toBe('original');

      // Modify original and verify clone is independent
      entity.name!.nickname = 'modified';
      expect(clonedEntity.name!.nickname).toBe('original');

      world.close();
    });

    it('should clone entity with complex nested data', async () => {
      const edl = `
      def inventory { items: json }
      def stats { health: int mana: int attributes: json }
      `;
      const world = await createWorld(edl, worldOpts);
      const entity = world.create({
        inventory: {
          items: [
            { damage: 10, id: 'sword' },
            { defense: 5, id: 'shield' }
          ]
        },
        stats: {
          attributes: { agility: 12, strength: 15 },
          health: 100,
          mana: 50
        }
      });

      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.id).not.toBe(entity.id);
      expect(clonedEntity.inventory!.items).toEqual([
        { damage: 10, id: 'sword' },
        { defense: 5, id: 'shield' }
      ]);
      expect(clonedEntity.stats!.attributes).toEqual({
        agility: 12,
        strength: 15
      });

      // Verify deep copy - modifying nested data doesn't affect clone
      entity.inventory!.items[0].damage = 20;
      expect(clonedEntity.inventory!.items[0].damage).toBe(10);

      world.close();
    });

    it('should clone entity with no components', async () => {
      const world = await createWorld([], worldOpts);
      const entity = world.create({});

      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.id).not.toBe(entity.id);

      world.close();
    });

    it('should throw error when cloning non-existent entity ID', async () => {
      const world = await createWorld([], worldOpts);

      expect(() => world.clone(99_999)).toThrow(
        'Entity not found with ID: 99999'
      );

      world.close();
    });

    it('should clone entity with default values', async () => {
      const statsComponent = defineComponent({
        id: 'stats',
        schema: {
          health: s.int().default(100),
          mana: s.int().default(50)
        }
      });
      const world = await createWorld([statsComponent], worldOpts);
      const entity = world.create({
        stats: { health: 200 } // only set health, mana should get default
      });

      // Check that the original entity has the default
      expect(entity.stats!.health).toBe(200);
      expect(entity.stats!.mana).toBe(50);

      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.stats!.health).toBe(200);
      expect(clonedEntity.stats!.mana).toBe(50); // default value

      world.close();
    });

    it('should clone entity with different data types', async () => {
      const edl = `
      def mixed {
        str: string
        num: float
        bool: bool
        date: datetime
        arr: json
      }
      `;
      const world = await createWorld(edl, worldOpts);
      const testDate = new Date('2023-01-01T00:00:00Z');
      const entity = world.create({
        mixed: {
          arr: [1, 2, 3],
          bool: true,
          date: testDate,
          num: 42.5,
          str: 'test'
        }
      });

      const clonedEntity = world.clone(entity);
      expect(clonedEntity).toBeDefined();
      expect(clonedEntity.mixed!.str).toBe('test');
      expect(clonedEntity.mixed!.num).toBe(42.5);
      expect(clonedEntity.mixed!.bool).toBe(true);
      expect(clonedEntity.mixed!.date).toEqual(testDate);
      expect(clonedEntity.mixed!.arr).toEqual([1, 2, 3]);

      world.close();
    });

    it('should maintain independence after cloning and flushing', async () => {
      const edl = `
      def counter { value: int }
      `;
      const world = await createWorld(edl, worldOpts);
      const entity = world.create({
        counter: { value: 1 }
      });

      const clonedEntity = world.clone(entity);
      expect(clonedEntity.counter!.value).toBe(1);

      // Modify both entities
      entity.counter!.value = 10;
      clonedEntity.counter!.value = 20;

      world.flush();

      const entities = world.queryAll({ with: ['counter'] });
      expect(entities).toHaveLength(2);
      const values = entities.map(e => e!.counter!.value).sort();
      expect(values).toEqual([10, 20]);

      world.close();
    });
  });
});
