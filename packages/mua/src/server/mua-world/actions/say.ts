import { getEntity, getLocationOf, nameOf } from '../queries/entity';
import { refused, type ActionContext, type ActionOutcome } from './types';

export const sayAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, text, world } = ctx;

  if (!text) {
    return refused('What do you want to say?');
  }

  const room = getLocationOf(world, playerId);
  if (room === undefined) {
    return refused('There is nobody here to hear you.');
  }

  return {
    broadcasts: [
      {
        exclude: playerId,
        message: `${nameOf(world, playerId)} says, "${text}"`,
        to: room
      }
    ],
    kind: 'done',
    message: `You say, "${text}"`,
    notices: [
      { args: [{ entity: playerId }, text], message: 'heard', to: room }
    ]
  };
};

export const sayToAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, targetId, text, world } = ctx;
  const isListener =
    getEntity(world, targetId, ['player']) ??
    getEntity(world, targetId, ['npc']);
  if (!isListener || targetId === undefined) {
    return refused("They can't hear you.");
  }
  if (targetId === playerId) {
    return refused('You mutter to yourself.');
  }
  if (!text) {
    return refused('What do you want to say?');
  }

  const room = getLocationOf(world, playerId);
  const name = nameOf(world, targetId);
  return {
    broadcasts:
      room === undefined
        ? undefined
        : [
            {
              exclude: playerId,
              message: `${nameOf(world, playerId)} says to ${name}, "${text}"`,
              to: room
            }
          ],
    kind: 'done',
    message: `You say to ${name}, "${text}"`,
    notices:
      room === undefined
        ? undefined
        : [
            {
              args: [{ entity: playerId }, text],
              message: 'heard',
              to: room
            }
          ]
  };
};
