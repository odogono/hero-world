import type { EntityId } from 'odgn-ecs/types';
import { createLog } from 'odgn-helpers/log';

import { getEntity, getLocationOf } from '../queries/entity';
import { NO_SCRIPTS, type ScriptRunner } from '../scripts/runner';
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
import {
  PASS,
  done,
  refused,
  type ActionContext,
  type ActionOutcome
} from './types';

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

/** Most game-loop passes to wait for a Script's reply before giving up on it (about one pass per tick while it stays silent) */
export const MAX_WAIT_TICKS = 50;

/** How far dispatch has got with a command */
export type DispatchState = {
  /** The receiver reached: an index into the receivers, then the built-in */
  stage: number;
  /** Ticks spent waiting on a Script at this stage */
  waitTicks: number;
};

export type DispatchStep =
  | { kind: 'finished'; outcome: ActionOutcome }
  | { kind: 'waiting'; state: DispatchState };

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

const finished = (outcome: ActionOutcome): DispatchStep => ({
  kind: 'finished',
  outcome: outcome.kind === 'pass' ? refused(CANNOT) : outcome
});

export type StepOptions = {
  /** Identifies this command's Script requests across ticks */
  key: string;
  scripts?: ScriptRunner;
  state?: DispatchState;
};

/**
 * Moves a command along its receivers, and the first that handles it wins:
 * the room it happens in, then the second object, then the thing acted on,
 * then the built-in action. At each receiver a fixed response is checked,
 * then its Scripts. A Script answers on a later tick, so the step may stop
 * and wait; call it again on the next tick with the state it returned.
 */
export const stepCommand = (
  ctx: ActionContext,
  { key, scripts = NO_SCRIPTS, state = { stage: 0, waitTicks: 0 } }: StepOptions
): DispatchStep => {
  const receivers: [Role, EntityId | undefined][] = [
    ['room', getLocationOf(ctx.world, ctx.playerId)],
    ['indirect', ctx.indirectId],
    ['target', ctx.targetId]
  ];

  for (let stage = state.stage; stage < receivers.length; stage++) {
    const [role, id] = receivers[stage]!;
    if (id === undefined) {
      continue;
    }
    const response = responseFrom(ctx, id, role);
    if (response !== undefined) {
      return finished(refused(response));
    }
    if (!scripts.hasScript(id)) {
      continue;
    }

    const requestKey = `${key}:${stage}`;
    const reply = scripts.offer(requestKey, id, ctx.verb, role, ctx.playerId);
    if (reply.kind === 'waiting') {
      const waitTicks = stage === state.stage ? state.waitTicks + 1 : 1;
      if (waitTicks <= MAX_WAIT_TICKS) {
        return { kind: 'waiting', state: { stage, waitTicks } };
      }
      log.warn(`Gave up waiting for a Script to answer ${ctx.verb}`);
      scripts.forget(requestKey);
      return finished(refused('Nothing happens.'));
    }
    scripts.forget(requestKey);
    if (reply.kind === 'replied') {
      return finished(done(reply.message ?? ''));
    }
    if (reply.kind === 'failed') {
      return finished(refused('Something went wrong.'));
    }
    // passed: on to the next receiver
  }

  return finished(runBuiltIn(ctx));
};

/** Dispatches a command that no Script can delay, in one step */
export const dispatchCommand = (ctx: ActionContext): ActionOutcome => {
  const step = stepCommand(ctx, { key: 'sync' });
  return step.kind === 'finished' ? step.outcome : refused(CANNOT);
};
