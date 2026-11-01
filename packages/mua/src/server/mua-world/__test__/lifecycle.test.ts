import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getEntity, getLocationOf } from '../queries/entity';
import { findPlayerByName } from '../queries/player';
import { findRoomByMetaId } from '../queries/room';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/lifecycle.edl';

describe('Limbo and lifecycle', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const ecs = () => world.muaWorld.world!;
  const send = (text: string) => world.sendAndWait(bob, text);
  const shrineId = () => findRoomByMetaId(ecs(), 'west_of_house')!.id;
  const thing = (name: string) =>
    ecs()
      .queryAll({ with: ['described', 'location'] })
      .find(e => e.described.name === name)!.id;

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('has Limbo and a system actor', () => {
    const { limbo, system } = world.muaWorld.places!;

    expect(getEntity(ecs(), limbo, ['described'])?.described.name).toBe(
      'Limbo'
    );
    expect(getLocationOf(ecs(), system)).toBe(limbo);
  });

  it('sends a player who leaves to Limbo, and back when they return', async () => {
    const alice = await world.login('alice');
    alice.messages.length = 0;

    world.muaWorld.onConnectionClosed(bob);
    await world.muaWorld.tick(1000);

    const bobId = findPlayerByName(ecs(), 'bob')!.id;
    expect(getLocationOf(ecs(), bobId)).toBe(world.muaWorld.places!.limbo);
    expect(alice.messages).toContain('bob fades from view.');
    expect(await world.sendAndWait(alice, 'look')).not.toContain('bob');

    alice.messages.length = 0;
    bob = await world.login('bob');
    await world.muaWorld.tick(1000);

    expect(getLocationOf(ecs(), bobId)).toBe(shrineId());
    expect(alice.messages).toContain('bob appears.');
  });

  it('puts strayed things back when a place resets', async () => {
    await send('take lamp');
    await send('east');
    await send('drop lamp');

    expect(world.muaWorld.resetPlace(shrineId())).toBe(1);
    expect(getLocationOf(ecs(), thing('Lamp'))).toBe(shrineId());
  });

  it('leaves what a player carries when a place resets', async () => {
    await send('take lamp');
    await send('east');

    expect(world.muaWorld.resetPlace(shrineId())).toBe(0);
  });

  it("tells a place's Scripts it has reset", async () => {
    world.muaWorld.resetPlace(shrineId());
    await world.muaWorld.tick(1000);

    expect(bob.messages).toContain('Dust settles over the shrine.');
  });

  it('tells Scripts the world has started', async () => {
    await world.muaWorld.tick(1000);

    const idol = getEntity(ecs(), thing('Idol'), ['item']);
    expect(idol?.item.weight).toBe(7);
  });
});
