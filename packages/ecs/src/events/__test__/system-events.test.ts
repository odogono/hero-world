import { describe, expect, test } from 'bun:test';

import { defineComponent, s } from '@component';
import { DatabaseType } from '@db';
import { createGameLoop, createSystem } from '@system';
import { createWorld } from '@world';

import { eventComponent } from '..';

// Test components
const testComponent = defineComponent({
  id: 'systemTest',
  schema: {
    value: s.number()
  }
});

const dbType = (process.env.DB_TYPE as DatabaseType) ?? DatabaseType.BUN;

const createTestWorld = async () =>
  await createWorld([eventComponent, testComponent], { dbType });

describe('System Events Integration', () => {
  test('should work with entity systems', async () => {
    const world = await createTestWorld();

    const gameLoop = createGameLoop(world);

    // Create some test entities
    world.create({ systemTest: { value: 10 } });
    world.create({ systemTest: { value: 20 } });
    world.flush();

    const processedEntities: any[] = [];

    const entitySystem = createSystem(
      ({ deltaTime, entity, world }) => {
        processedEntities.push(entity);
      },
      { with: ['systemTest'] }
    );

    gameLoop.addSystem('entity-system', entitySystem);

    world.flush();

    // Run the game loop
    gameLoop.update(16);

    // System should receive both entities and events
    expect(processedEntities).toHaveLength(2);
  });
});
