import { describe, expect, it } from 'bun:test';
import { queryEntity } from 'odgn-ecs/entity';

import { moveUnit } from '@server/game/system/command';

import { createWorld, spawnTank } from '../world';

describe('world', () => {
  it('should create a world', async () => {
    const { loop, world } = await createWorld();
    expect(world).toBeDefined();
    expect(loop).toBeDefined();
  });

  it.only('should spawn a tank', async () => {
    const tankWorld = await createWorld();
    const tank = spawnTank(tankWorld, 'red', 0, 0);
    // tankWorld.world.flush();
    expect(tank.id).toBeDefined();

    tankWorld.loop.update(16);

    // console.debug('moving unit');
    moveUnit(tankWorld, tank.id, 10, 10);
    // console.debug('flushing world');
    // tankWorld.world.flush();

    tankWorld.loop.update(16);
    tankWorld.loop.update(16);
    tankWorld.loop.update(16);

    const e = queryEntity(tankWorld.world, { with: ['position', 'moveOrder'] });

    expect(e.moveOrder).toBeDefined();

    // console.debug('e', e);
    console.debug(tankWorld.world.db.saveToJSON());
  });
});
