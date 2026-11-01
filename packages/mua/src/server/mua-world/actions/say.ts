import { getEntity } from '../queries/entity';
import { refused, type ActionContext, type ActionOutcome } from './types';

export const sayAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, text, world } = ctx;

  if (!text) {
    return refused('What do you want to say?');
  }

  const player = getEntity(world, playerId, ['player', 'location']);
  if (!player) {
    return refused('There is nobody here to hear you.');
  }

  return {
    broadcast: {
      exclude: playerId,
      message: `${player.player.name} says, "${text}"`,
      roomId: player.location.in
    },
    kind: 'done',
    message: `You say, "${text}"`
  };
};

export const sayToAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, targetId, text, world } = ctx;
  const listener = getEntity(world, targetId, ['player']);
  if (!listener) {
    return refused("They can't hear you.");
  }
  if (listener.id === playerId) {
    return refused('You mutter to yourself.');
  }
  if (!text) {
    return refused('What do you want to say?');
  }

  const speaker = getEntity(world, playerId, ['player', 'location']);
  const { name } = listener.player;
  return {
    broadcast: speaker && {
      exclude: playerId,
      message: `${speaker.player.name} says to ${name}, "${text}"`,
      roomId: speaker.location.in
    },
    kind: 'done',
    message: `You say to ${name}, "${text}"`
  };
};
