import type { EntityId } from 'odgn-ecs/types';
import { createLog } from 'odgn-helpers/log';

import { getEntity, getLocationOf } from '../queries/entity';
import {
  NO_SCRIPTS,
  type Receiver,
  type ScriptArg,
  type ScriptReply,
  type ScriptRunner
} from '../scripts/runner';
import { helpAction, readAction } from './help';
import { lockAction, unlockAction } from './locks';
import {
  closeAction,
  dropAction,
  examineAction,
  inventoryAction,
  openAction,
  takeAction
} from './objects';
import { sayAction, sayToAction } from './say';
import { isScripted, planScripted, scriptedOutcome } from './scripted';
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
  help: helpAction,
  inventory: inventoryAction,
  lock: lockAction,
  open: openAction,
  read: readAction,
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
  id: Receiver,
  role: Role | 'veto',
  key: string = ctx.verb
): string | undefined => {
  if (typeof id === 'object') {
    return undefined;
  }
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
  /** What the built-in action did, once it has run */
  outcome?: ActionOutcome;
  /**
   * The question reached: an index into the receivers and vetoes, then the
   * built-in, then the `after` questions
   */
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
  id: Receiver;
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
      // a scripted action answered by a receiver still sends the RoomView
      onReply: message =>
        isScripted(ctx.verb)
          ? scriptedOutcome(ctx, message ?? '')
          : done(message ?? ''),
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
 * Where the `after` questions' stages start. The questions before the
 * built-in are worked out from the world as it is, so once the built-in has
 * changed it (a taken thing has no more veto questions), their count can
 * change: `after` stages are numbered from here instead.
 */
const AFTER_STAGE = 1000;

/**
 * The stage of a scripted action (see scripted.ts), between the questions
 * and the `after` questions, numbered apart for the same reason.
 */
const ACTION_STAGE = 500;

/** `afterExamine`, `afterTake`: the message sent once a built-in succeeds */
const afterMessage = (verb: string) =>
  `after${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;

type Asked =
  | { kind: 'answered'; reply: Exclude<ScriptReply, { kind: 'waiting' }> }
  | { kind: 'gave up' }
  | { kind: 'waiting'; state: DispatchState };

/** Asks one question of a Script, keeping track of how long it has waited */
const ask = (
  ctx: ActionContext,
  question: Question,
  stage: number,
  { key, scripts, state }: Required<StepOptions>
): Asked => {
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
      return {
        kind: 'waiting',
        state: { outcome: state.outcome, stage, waitTicks }
      };
    }
    log.warn(`Gave up waiting for a Script to answer ${question.message}`);
    scripts.forget(requestKey);
    return { kind: 'gave up' };
  }
  scripts.forget(requestKey);
  return { kind: 'answered', reply };
};

/**
 * Moves a command along the questions dispatch asks:
 * 1. the receivers — the room it happens in, the second object, the thing
 *    acted on — any of which may handle the command;
 * 2. the veto questions of the built-in action (see vetoes.ts), any of
 *    which may refuse it;
 * 3. the action itself: a built-in, or for `look` and `move` a request to
 *    one of mua's Service Scripts (see scripted.ts);
 * 4. once it has succeeded, `after<Verb>` (`afterExamine`) to the same
 *    receivers, whose replies are added to the built-in's.
 * Each question is answered by a fixed response, else by Scripts. A Script
 * answers on a later pass, so the step may stop and wait; call it again
 * with the state it returned.
 */
export const stepCommand = (
  ctx: ActionContext,
  { key, scripts = NO_SCRIPTS, state = { stage: 0, waitTicks: 0 } }: StepOptions
): DispatchStep => {
  const options = { key, scripts, state };
  const questions = [...receiverQuestions(ctx), ...vetoQuestions(ctx)];

  if (state.outcome === undefined && state.stage < ACTION_STAGE) {
    for (let stage = state.stage; stage < questions.length; stage++) {
      const question = questions[stage]!;
      if (question.response !== undefined) {
        return finished(refused(question.response));
      }
      if (!scripts.hasScript(question.id)) {
        continue;
      }
      const asked = ask(ctx, question, stage, options);
      if (asked.kind === 'waiting') {
        return asked;
      }
      if (asked.kind === 'gave up') {
        return finished(refused('Nothing happens.'));
      }
      if (asked.reply.kind === 'replied') {
        return finished(question.onReply(asked.reply.message));
      }
      if (asked.reply.kind === 'failed') {
        return finished(refused('Something went wrong.'));
      }
      // passed: on to the next question
    }
  }

  // the action runs once; its outcome is kept while `after` waits
  let outcome = state.outcome;
  if (outcome === undefined) {
    if (isScripted(ctx.verb)) {
      const step = runScripted(ctx, options);
      if (step.kind === 'waiting') {
        return step;
      }
      outcome = step.outcome;
    } else {
      outcome = runBuiltIn(ctx);
    }
  }
  if (outcome.kind !== 'done') {
    return finished(outcome);
  }

  const afters = receiverQuestions(ctx).map(q => ({
    ...q,
    message: afterMessage(ctx.verb)
  }));
  const first = AFTER_STAGE;
  let message = outcome.message;
  for (
    let stage = Math.max(state.stage, first);
    stage < first + afters.length;
    stage++
  ) {
    const question = afters[stage - first]!;
    if (!scripts.hasScript(question.id)) {
      continue;
    }
    const asked = ask(ctx, question, stage, {
      ...options,
      state: { ...state, outcome: { ...outcome, message } }
    });
    if (asked.kind === 'waiting') {
      return asked;
    }
    if (
      asked.kind === 'answered' &&
      asked.reply.kind === 'replied' &&
      asked.reply.message
    ) {
      message = message
        ? `${message}\n${asked.reply.message}`
        : asked.reply.message;
    }
  }
  return finished({ ...outcome, message });
};

/**
 * Runs a scripted action: sends its request to a Service Script, then waits
 * for the reply. The request is planned only when first sent; once it has
 * run, the world has changed and the plan would differ.
 */
const runScripted = (
  ctx: ActionContext,
  options: Required<StepOptions>
): DispatchStep => {
  const isSent = options.state.stage === ACTION_STAGE;
  const plan = isSent ? undefined : planScripted(ctx);
  if (plan && 'kind' in plan) {
    return finished(plan.outcome);
  }
  const to = plan?.to ?? { service: ctx.verb };
  if (!options.scripts.hasScript(to) && !isSent) {
    return finished(PASS);
  }
  const question: Question = {
    // a request already sent is answered from its key; these go unused
    args: plan?.args ?? [],
    asks: 'offer',
    id: to,
    message: plan?.message ?? ctx.verb,
    onReply: message => scriptedOutcome(ctx, message ?? ''),
    response: undefined
  };
  const asked = ask(ctx, question, ACTION_STAGE, options);
  if (asked.kind === 'waiting') {
    return asked;
  }
  if (asked.kind === 'gave up') {
    return finished(refused('Nothing happens.'));
  }
  if (asked.reply.kind === 'replied') {
    return finished(question.onReply(asked.reply.message));
  }
  if (asked.reply.kind === 'failed') {
    return finished(refused('Something went wrong.'));
  }
  return finished(PASS);
};

/** Dispatches a command that no Script can delay, in one step */
export const dispatchCommand = (ctx: ActionContext): ActionOutcome => {
  const step = stepCommand(ctx, { key: 'sync' });
  return step.kind === 'finished' ? step.outcome : refused(CANNOT);
};
