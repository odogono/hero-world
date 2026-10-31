import { createSystem } from 'odgn-ecs/system';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from '../coms';
import { findExitByDirection } from '../queries/room';
import { sendToPlayer, type MuaTalk } from '../talk';

const log = createLog('actions');

const locationOf = (world: World<MuaComponents>, playerId: EntityId) =>
  world.query({ entity: { id: playerId, world } as never, with: ['location'] })
    ?.location.in;

/** Ask the exit's Scripts whether the player may pass, then traverse it */
const traverse = (
  talk: MuaTalk,
  world: World<MuaComponents>,
  playerId: EntityId,
  exitId: EntityId
) => {
  const actor = talk.handle(playerId).value;
  talk
    .decide(exitId, 'beforeTraverse', actor)
    .decided.then(({ verdict, vetoes }) => {
      if (verdict === 'allowed') {
        talk.deliver(exitId, 'traverse', actor);
      } else if (verdict === 'vetoed') {
        const reason = vetoes[0]?.reason.asText() ?? "You can't go that way.";
        sendToPlayer(world, playerId, reason);
      } else {
        sendToPlayer(world, playerId, 'Something went wrong.');
      }
    })
    .catch(error => {
      log.error('beforeTraverse failed', error);
      sendToPlayer(world, playerId, 'Something went wrong.');
    });
};

/**
 * Parsed commands become messages to Scripts: `look` goes to the player's
 * room, `move` asks the exit's `beforeTraverse` Decision and then delivers
 * `traverse`. Scripts answer with `show`, which the show system turns into
 * output.
 */
export const createActionSystem = (talk: MuaTalk) =>
  createSystem(
    ({ entity, world }) => {
      if (!entity.commandEvent) {
        return;
      }
      const { direction, playerId, verb } = entity.commandEvent;
      world.delete(entity);

      const player = world.query({
        asProxy: true,
        entity: { id: playerId, world } as never,
        with: ['player']
      });
      if (!player) {
        return;
      }
      player.player.lastCommandAt = new Date().toISOString();

      const roomId = locationOf(world, playerId);
      if (roomId === undefined) {
        sendToPlayer(world, playerId, 'You are nowhere.');
        return;
      }

      switch (verb) {
        case 'look': {
          talk.deliver(roomId, 'look', talk.handle(playerId).value);
          return;
        }
        case 'move': {
          if (!direction) {
            sendToPlayer(world, playerId, 'Which direction?');
            return;
          }
          const exit = findExitByDirection(world, roomId, direction);
          if (!exit) {
            sendToPlayer(
              world,
              playerId,
              `You can't go ${direction} from here.`
            );
            return;
          }
          traverse(talk, world, playerId, exit.id);
          return;
        }
        default: {
          sendToPlayer(
            world,
            playerId,
            `Command "${verb}" not implemented yet.`
          );
        }
      }
    },
    {
      frequency: 1,
      priority: 30,
      with: ['commandEvent']
    }
  );
