import type { EntityId } from 'odgn-ecs/types';
import { createLog } from 'odgn-helpers/log';

import { getEntity, getLocationOf } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { sendToPlayer, type MuaTalk } from '../talk';
import { lookAction } from './look';
import {
  STARTED,
  messageOf,
  refused,
  type ActionContext,
  type ActionOutcome
} from './types';

const log = createLog('move');

/**
 * Ask the exit's Scripts whether the player may pass, then have it traverse
 * them. The exit's Scripts move the player and tell the room they arrive in;
 * once they finish, the player is shown that room.
 */
const traverse = (
  ctx: ActionContext,
  talk: MuaTalk,
  exitId: EntityId,
  fromId: EntityId
) => {
  const { playerId, world } = ctx;
  const actor = talk.handle(playerId).value;
  const fail = (error: unknown) => {
    log.error('traverse failed', error);
    sendToPlayer(world, playerId, 'Something went wrong.');
  };
  talk
    .decide(exitId, 'beforeTraverse', actor)
    .decided.then(({ verdict, vetoes }) => {
      if (verdict === 'vetoed') {
        const reason = vetoes[0]?.reason.asText() ?? "You can't go that way.";
        sendToPlayer(world, playerId, reason);
        return;
      }
      if (verdict !== 'allowed') {
        fail(verdict);
        return;
      }
      return talk.request(exitId, 'traverse', actor).result.then(() => {
        if (getLocationOf(world, playerId) !== fromId) {
          const view = messageOf(lookAction(ctx));
          if (view !== undefined) {
            sendToPlayer(world, playerId, view);
          }
        }
      });
    })
    .catch(fail);
};

export const moveAction = (ctx: ActionContext): ActionOutcome => {
  const { direction, playerId, world } = ctx;

  if (!direction) {
    return refused('Which direction?');
  }

  const player = getEntity(world, playerId, ['location'], true);
  if (!player) {
    return refused('You are nowhere.');
  }

  const currentRoom = player.location.in;
  const exit = findExitByDirection(world, currentRoom, direction);

  if (!exit) {
    return refused(`You can't go ${direction} from here.`);
  }

  // An exit made from an atom with a Script is moved through by Scripts
  if (ctx.talk && getEntity(world, exit.id, ['script'])) {
    traverse(ctx, ctx.talk, exit.id, currentRoom);
    return STARTED;
  }

  if (!exit.portal.to && exit.portal.msg) {
    return refused(exit.portal.msg);
  }

  if (!exit.portal.to) {
    return refused('That exit leads nowhere.');
  }

  // Move player
  player.location = { in: exit.portal.to };
  world.flush();

  // Auto-look at new room
  const lookResult = lookAction(ctx);

  return {
    broadcast: {
      exclude: playerId,
      message: `${getEntity(world, playerId, ['player'])?.player.name ?? 'Someone'} arrives.`,
      roomId: exit.portal.to
    },
    kind: 'done',
    message: messageOf(lookResult) ?? ''
  };
};
