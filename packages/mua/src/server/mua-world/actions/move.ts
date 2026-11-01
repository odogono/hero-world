import { getEntity } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { lookAction } from './look';
import { messageFor } from './messages';
import { refused, type ActionContext, type ActionOutcome } from './types';

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

  if (!exit.portal.to && exit.portal.msg) {
    return refused(exit.portal.msg);
  }

  if (!exit.portal.to) {
    return refused('That exit leads nowhere.');
  }

  // Move player
  player.location = { in: exit.portal.to };
  world.flush();

  // the exit's `messages` can replace what is said as the actor passes
  const passing = messageFor(ctx, 'move', 'msg', exit.id);
  const left = messageFor(ctx, 'move', 'omsg', exit.id);
  const arrived = messageFor(ctx, 'arrive', 'omsg', exit.id);

  // Auto-look at new room
  const look = lookAction(ctx);
  const seen = look.kind === 'done' ? look : undefined;

  return {
    broadcasts: [
      ...(left ? [{ exclude: playerId, message: left, to: currentRoom }] : []),
      ...(arrived
        ? [{ exclude: playerId, message: arrived, to: exit.portal.to }]
        : [])
    ],
    kind: 'done',
    message: [passing, seen?.message].filter(Boolean).join('\n'),
    room: seen?.room
  };
};
