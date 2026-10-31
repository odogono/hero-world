import { findExitByDirection } from '../queries/room';
import { lookAction } from './look';
import type { ActionContext, ActionResult } from './types';

export const moveAction = (ctx: ActionContext): ActionResult => {
  const { direction, playerId, world } = ctx;

  if (!direction) {
    return { message: 'Which direction?' };
  }

  const player = world.get(playerId);
  if (!player?.player?.location) {
    return { message: 'You are nowhere.' };
  }

  const currentRoom = player.player.location;
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
  player.player.location = exit.portal.to;

  // Auto-look at new room
  const lookResult = lookAction(ctx);

  return {
    broadcast: {
      message: `${player.player.name} arrives.`,
      roomId: exit.portal.to
    },
    message: lookResult.message
  };
};
