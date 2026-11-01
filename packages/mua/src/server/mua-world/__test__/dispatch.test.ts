import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { MAX_WAIT_TICKS, dispatchCommand, stepCommand } from '../actions';
import { getInScope } from '../queries/scope';
import type { ScriptRunner } from '../scripts/runner';
import { openTestWorld, type TestConnection } from './helpers';

const FIXTURE = 'src/server/mua-world/__test__/fixtures/objects.edl';

describe('Dispatch', () => {
  let world: Awaited<ReturnType<typeof openTestWorld>>;
  let bob: TestConnection;

  const send = (text: string) => world.send(bob, text);

  const muaWorld = () => world.muaWorld.world!;
  const playerId = () =>
    muaWorld().query({
      args: ['bob'],
      where: 'player.name = ?1',
      with: ['player']
    })!.id;
  const idOf = (name: string) =>
    getInScope(muaWorld(), playerId(), 'here').find(c => c.name === name)!.id;

  beforeEach(async () => {
    world = await openTestWorld(FIXTURE);
    bob = await world.login('bob');
  });

  afterEach(async () => {
    await world.muaWorld.close();
  });

  describe('target responses', () => {
    it('refuse instead of the built-in action, inherited from an atom', () => {
      expect(send('take statue')).toBe("It's bolted to the floor.");
      expect(send('i')).toBe('You are empty-handed.');
    });

    it('only apply to their own verb', () => {
      expect(send('examine statue')).toBe('A marble statue.');
    });

    it('apply to each object of a multi-object command', () => {
      expect(send('take lamp and statue')).toBe(
        "Lamp: Taken.\nStatue: It's bolted to the floor."
      );
    });
  });

  describe('room responses', () => {
    it('refuse commands made inside the room', async () => {
      const alice = await world.login('alice');
      send('take lamp');
      send('east');
      alice.messages.length = 0;

      expect(send('drop lamp')).toBe(
        'The floor is too sacred to drop things on.'
      );
      expect(send('say hello')).toBe('The silence swallows your words.');
      expect(send('i')).toBe('You are carrying: the lamp.');
      expect(alice.messages).toEqual([]);
    });

    it('do not apply in other rooms', () => {
      send('take lamp');
      expect(send('drop lamp')).toBe('Dropped.');
    });
  });

  describe('order', () => {
    it('asks the second object before the thing acted on', () => {
      const outcome = dispatchCommand({
        indirectId: idOf('Plinth'),
        playerId: playerId(),
        targetId: idOf('Crate'),
        verb: 'open',
        world: muaWorld()
      });

      expect(outcome).toEqual({
        kind: 'refused',
        message: 'The plinth is not a key.'
      });
    });

    it('falls through to the built-in action when nobody responds', () => {
      const outcome = dispatchCommand({
        playerId: playerId(),
        targetId: idOf('Crate'),
        verb: 'open',
        world: muaWorld()
      });

      expect(outcome).toMatchObject({ kind: 'done' });
    });

    it('refuses a verb that nothing handles', () => {
      const outcome = dispatchCommand({
        playerId: playerId(),
        verb: 'dance',
        world: muaWorld()
      });

      expect(outcome).toEqual({
        kind: 'refused',
        message: "You can't do that."
      });
    });
  });

  describe('waiting on Scripts', () => {
    const silent: ScriptRunner = {
      decide: () => ({ kind: 'waiting' }),
      forget: () => {},
      hasScript: () => true,
      notify: () => {},
      offer: () => ({ kind: 'waiting' }),
      settled: () => 0
    };

    it('waits while a Script has not answered', () => {
      const step = stepCommand(
        { playerId: playerId(), verb: 'look', world: muaWorld() },
        { key: 'test', scripts: silent }
      );

      expect(step).toEqual({
        kind: 'waiting',
        state: { stage: 0, waitTicks: 1 }
      });
    });

    it('gives up on a Script that never answers', () => {
      const step = stepCommand(
        { playerId: playerId(), verb: 'look', world: muaWorld() },
        {
          key: 'test',
          scripts: silent,
          state: { stage: 0, waitTicks: MAX_WAIT_TICKS }
        }
      );

      expect(step).toEqual({
        kind: 'finished',
        outcome: { kind: 'refused', message: 'Nothing happens.' }
      });
    });
  });
});
