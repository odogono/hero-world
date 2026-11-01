import { getEntity } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { lookAction } from './look';
import type { ActionContext, ActionResult } from './types';

export const moveAction = (ctx: ActionContext): ActionResult => {
  const { direction, playerId, world } = ctx;

  if (!direction) {
    return { message: 'Which direction?' };
  }

  const player = getEntity(world, playerId, ['location'], true);
  if (!player) {
    return { message: 'You are nowhere.' };
  }

  const currentRoom = player.location.in;
  const exit = findExitByDirection(world, currentRoom, direction);

  if (!exit) {
    return { message: `You can't go ${direction} from here.` };
  }

  if (!exit.portal.to && exit.portal.msg) {
    return { message: exit.portal.msg };
  }

  if (!exit.portal.to) {
    return { message: 'That exit leads nowhere.' };
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
    message: lookResult.message
  };
};
