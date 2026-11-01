import type { EntityId } from 'odgn-ecs/types';
import { createLog } from 'odgn-helpers/log';

import { getEntity, getLocationOf } from '../queries/entity';
import {
  NO_SCRIPTS,
  type ScriptArg,
  type ScriptRunner
} from '../scripts/runner';
import { lockAction, unlockAction } from './locks';
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
import { vetoesFor } from './vetoes';

export * from './types';

const log = createLog('actions');

type Handler = (ctx: ActionContext) => ActionOutcome;

const BUILT_IN: Record<string, Handler> = {
  close: closeAction,
  drop: dropAction,
  examine: examineAction,
  inventory: inventoryAction,
  lock: lockAction,
  look: lookAction,
  move: moveAction,
  open: openAction,
  say: sayAction,
  sayTo: sayToAction,
  take: takeAction,
  unlock: unlockAction
};

/** The part an entity plays in a command */
export type Role = 'indirect' | 'room' | 'target';

const CANNOT = "You can't do that.";

/** A fixed reply from the entity's `responses`, by role (or `veto`) and key */
const responseFrom = (
  ctx: ActionContext,
  id: EntityId,
  role: Role | 'veto',
  key: string = ctx.verb
): string | undefined => {
  const entity = getEntity(ctx.world, id, ['responses']);
  const table: unknown = entity?.responses[role];
  if (typeof table !== 'object' || table === null) {
    return undefined;
  }
  const reply = (table as Record<string, unknown>)[key];
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

/** One thing dispatch asks, in turn: a receiver, or a veto question */
type Question = {
  args: ScriptArg[];
  /** A command is offered as a request; a veto question is a Decision */
  asks: 'decide' | 'offer';
  id: EntityId;
  message: string;
  /** What a reply means: the command is handled, or the action is vetoed */
  onReply: (message: string | undefined) => ActionOutcome;
  /** A fixed reply from `responses`, if any */
  response: string | undefined;
};

const receiverQuestions = (ctx: ActionContext): Question[] => {
  const receivers: [Role, EntityId | undefined][] = [
    ['room', getLocationOf(ctx.world, ctx.playerId)],
    ['indirect', ctx.indirectId],
    ['target', ctx.targetId]
  ];
  return receivers
    .filter((r): r is [Role, EntityId] => r[1] !== undefined)
    .map(([role, id]) => ({
      args: [role, { entity: ctx.playerId }],
      asks: 'offer' as const,
      id,
      message: ctx.verb,
      onReply: message => done(message ?? ''),
      response: responseFrom(ctx, id, role)
    }));
};

const vetoQuestions = (ctx: ActionContext): Question[] =>
  vetoesFor(ctx).map(({ event, id, subject }) => ({
    args: [{ entity: ctx.playerId }, { entity: subject }],
    asks: 'decide' as const,
    id,
    message: event,
    onReply: message => refused(message || CANNOT),
    response: responseFrom(ctx, id, 'veto', event)
  }));

/**
 * Moves a command along the questions dispatch asks, and stops at the first
 * that settles it:
 * 1. the receivers — the room it happens in, the second object, the thing
 *    acted on — any of which may handle the command;
 * 2. the veto questions of the built-in action (see vetoes.ts), any of
 *    which may refuse it;
 * 3. the built-in action itself.
 * Each question is answered by a fixed response, else by Scripts. A Script
 * answers on a later pass, so the step may stop and wait; call it again
 * with the state it returned.
 */
export const stepCommand = (
  ctx: ActionContext,
  { key, scripts = NO_SCRIPTS, state = { stage: 0, waitTicks: 0 } }: StepOptions
): DispatchStep => {
  const questions = [...receiverQuestions(ctx), ...vetoQuestions(ctx)];

  for (let stage = state.stage; stage < questions.length; stage++) {
    const question = questions[stage]!;
    if (question.response !== undefined) {
      return finished(refused(question.response));
    }
    if (scripts.hasScript(question.id)) {
      const requestKey = `${key}:${stage}`;
      const reply = scripts[question.asks](
        requestKey,
        question.id,
        question.message,
        question.args,
        {
          actor: ctx.playerId,
          direction: ctx.direction,
          indirect: ctx.indirectId,
          target: ctx.targetId,
          text: ctx.text,
          verb: ctx.verb
        }
      );
      if (reply.kind === 'waiting') {
        const waitTicks = stage === state.stage ? state.waitTicks + 1 : 1;
        if (waitTicks <= MAX_WAIT_TICKS) {
          return { kind: 'waiting', state: { stage, waitTicks } };
        }
        log.warn(`Gave up waiting for a Script to answer ${question.message}`);
        scripts.forget(requestKey);
        return finished(refused('Nothing happens.'));
      }
      scripts.forget(requestKey);
      if (reply.kind === 'replied') {
        return finished(question.onReply(reply.message));
      }
      if (reply.kind === 'failed') {
        return finished(refused('Something went wrong.'));
      }
      // passed: on to the next question
    }
  }

  return finished(runBuiltIn(ctx));
};

/** Dispatches a command that no Script can delay, in one step */
export const dispatchCommand = (ctx: ActionContext): ActionOutcome => {
  const step = stepCommand(ctx, { key: 'sync' });
  return step.kind === 'finished' ? step.outcome : refused(CANNOT);
};
