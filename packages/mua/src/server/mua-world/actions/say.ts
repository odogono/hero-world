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

export const sayToAction = (ctx: ActionContext): ActionResult => {
  const { playerId, targetId, text, world } = ctx;
  const listener = getEntity(world, targetId, ['player']);
  if (!listener) {
    return { message: "They can't hear you." };
  }
  if (listener.id === playerId) {
    return { message: 'You mutter to yourself.' };
  }
  if (!text) {
    return { message: 'What do you want to say?' };
  }

  const speaker = getEntity(world, playerId, ['player', 'location']);
  const { name } = listener.player;
  return {
    broadcast: speaker && {
      exclude: playerId,
      message: `${speaker.player.name} says to ${name}, "${text}"`,
      roomId: speaker.location.in
    },
    message: `You say to ${name}, "${text}"`
  };
};
