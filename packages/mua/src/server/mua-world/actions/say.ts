import { getEntity } from '../queries/entity';
import type { ActionContext, ActionResult } from './types';

export const sayAction = (ctx: ActionContext): ActionResult => {
  const { playerId, text, world } = ctx;

  if (!text) {
    return { message: 'What do you want to say?' };
  }

  const player = getEntity(world, playerId, ['player', 'location']);
  if (!player) {
    return { message: 'There is nobody here to hear you.' };
  }

  return {
    broadcast: {
      exclude: playerId,
      message: `${player.player.name} says, "${text}"`,
      roomId: player.location.in
    },
    message: `You say, "${text}"`
  };
};
