import type { EntityId } from 'odgn-ecs/types';
import { createLog } from 'odgn-helpers/log';

import { getEntity, getLocationOf } from '../queries/entity';
import { lookAction } from './look';
import { moveAction } from './move';
import {
  closeAction,
  dropAction,
  examineAction,
  inventoryAction,
  openAction,
  takeAction
} from './objects';
import { sayAction, sayToAction } from './say';
import { PASS, refused, type ActionContext, type ActionOutcome } from './types';

export * from './types';

const log = createLog('actions');

type Handler = (ctx: ActionContext) => ActionOutcome;

const BUILT_IN: Record<string, Handler> = {
  close: closeAction,
  drop: dropAction,
  examine: examineAction,
  inventory: inventoryAction,
  look: lookAction,
  move: moveAction,
  open: openAction,
  say: sayAction,
  sayTo: sayToAction,
  take: takeAction
};

/** The part an entity plays in a command */
export type Role = 'indirect' | 'room' | 'target';

const CANNOT = "You can't do that.";

/** A fixed reply for this role and verb from the entity's `responses` */
const responseFrom = (
  ctx: ActionContext,
  id: EntityId,
  role: Role
): string | undefined => {
  const entity = getEntity(ctx.world, id, ['responses']);
  const table: unknown = entity?.responses[role];
  if (typeof table !== 'object' || table === null) {
    return undefined;
  }
  const reply = (table as Record<string, unknown>)[ctx.verb];
  return typeof reply === 'string' ? reply : undefined;
};

/** Offers the command to one entity in one role */
const offer = (
  ctx: ActionContext,
  id: EntityId | undefined,
  role: Role
): ActionOutcome => {
  if (id === undefined) {
    return PASS;
  }
  const reply = responseFrom(ctx, id, role);
  return reply === undefined ? PASS : refused(reply);
};

const runBuiltIn = (ctx: ActionContext): ActionOutcome => {
  const handler = BUILT_IN[ctx.verb];
  if (!handler) {
    return PASS;
  }
  try {
    return handler(ctx);
  } catch (error) {
    log.error('Action error:', error);
    return refused('Something went wrong.');
  }
};

/**
 * Dispatches a command. Each receiver in turn may handle it, and the first
 * that does wins: the room it happens in, then the second object, then the
 * thing acted on, then the built-in action. A receiver that passes lets the
 * command go on to the next.
 */
export const dispatchCommand = (ctx: ActionContext): ActionOutcome => {
  const receivers: [Role, EntityId | undefined][] = [
    ['room', getLocationOf(ctx.world, ctx.playerId)],
    ['indirect', ctx.indirectId],
    ['target', ctx.targetId]
  ];
  for (const [role, id] of receivers) {
    const outcome = offer(ctx, id, role);
    if (outcome.kind !== 'pass') {
      return outcome;
    }
  }
  const outcome = runBuiltIn(ctx);
  return outcome.kind === 'pass' ? refused(CANNOT) : outcome;
};
