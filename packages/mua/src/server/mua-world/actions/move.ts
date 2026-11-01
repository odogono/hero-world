import type { EntityId } from 'odgn-ecs/types';

import { getEntity, getLocationOf } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { lookAction } from './look';
import { messageFor } from './messages';
import { refused, type ActionContext, type ActionOutcome } from './types';

const no = (message: string) => ({
  kind: 'refused' as const,
  outcome: refused(message)
});

/**
 * Where a move goes: the room it leaves, the exit and the room it enters, or
 * why it can't happen.
 */
export const planMove = (
  ctx: ActionContext
):
  | { exitId: EntityId; from: EntityId; kind: 'go'; to: EntityId }
  | { kind: 'refused'; outcome: ActionOutcome } => {
  const { direction, playerId, world } = ctx;

  if (!direction) {
    return no('Which direction?');
  }
  const from = getLocationOf(world, playerId);
  if (from === undefined) {
    return no('You are nowhere.');
  }
  const exit = findExitByDirection(world, from, direction);
  if (!exit) {
    return no(`You can't go ${direction} from here.`);
  }
  const to = exit.portal.to ?? undefined;
  if (to === undefined) {
    return no(exit.portal.msg ?? 'That exit leads nowhere.');
  }
  return { exitId: exit.id, from, kind: 'go', to };
};

/**
 * Moves the actor through an exit. Veto questions (`exit` to the room left,
 * `enter` to the room entered; see vetoes.ts) are asked before this runs.
 */
export const moveAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, world } = ctx;
  const plan = planMove(ctx);
  if (plan.kind === 'refused') {
    return plan.outcome;
  }
  const player = getEntity(world, playerId, ['location'], true);
  if (!player) {
    return refused('You are nowhere.');
  }
  const currentRoom = plan.from;
  const exit = { id: plan.exitId, portal: { to: plan.to } };

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
