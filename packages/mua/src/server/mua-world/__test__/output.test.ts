import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getLocationOf } from '../queries/entity';
import { findPlayerByName } from '../queries/player';
import { tell } from '../systems/output';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/objects.edl';

describe('Output addressed to entities', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let alice: TestConnection;
  let bob: TestConnection;

  const ecs = () => world.muaWorld.world!;
  const idOf = (name: string) => findPlayerByName(ecs(), name)!.id;

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    alice = await world.login('alice');
    bob = await world.login('bob');
    alice.messages.length = 0;
    bob.messages.length = 0;
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  it('tells a player only them', () => {
    tell(ecs(), idOf('bob'), 'Psst.');
    world.tick(1);

    expect(bob.messages).toEqual(['Psst.']);
    expect(alice.messages).toEqual([]);
  });

  it('tells a room everyone inside it, less anyone excluded', () => {
    const roomId = getLocationOf(ecs(), idOf('bob'))!;
    tell(ecs(), roomId, 'The lights flicker.');
    tell(ecs(), roomId, 'Bob sneezes.', { exclude: idOf('bob') });
    world.tick(1);

    expect(alice.messages).toEqual(['The lights flicker.', 'Bob sneezes.']);
    expect(bob.messages).toEqual(['The lights flicker.']);
  });

  it('says nothing to a player who has gone', () => {
    world.muaWorld.onConnectionClosed(bob);
    tell(ecs(), idOf('bob'), 'Anyone there?');
    world.tick(1);

    expect(bob.messages).toEqual([]);
  });
});
