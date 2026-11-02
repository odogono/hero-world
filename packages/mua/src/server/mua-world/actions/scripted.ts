import type { EntityId } from 'odgn-ecs/types';

import { getLocationOf } from '../queries/entity';
import { findExitByDirection } from '../queries/room';
import { roomViewFor } from '../queries/view';
import type { Receiver, ScriptArg } from '../scripts/runner';
import { refused, type ActionContext, type ActionOutcome } from './types';

/**
 * A core action written as a Script: dispatch sends `message` with `args`
 * to one of mua's Service Scripts (behaviours/), and the reply is the
 * actor's message.
 */
export type ScriptedAction = {
  args: ScriptArg[];
  message: string;
  to: Receiver;
};

type Plan = ScriptedAction | { kind: 'refused'; outcome: ActionOutcome };

const no = (message: string) => ({
  kind: 'refused' as const,
  outcome: refused(message)
});

/**
 * Where a move goes: the room it leaves, the exit and the room it enters, or
 * why it can't happen. Whether a door lets the actor through is the exit
 * Service's `beforeTraverse` Decision (see vetoes.ts).
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

const lookPlan = (ctx: ActionContext): Plan => {
  const roomId = getLocationOf(ctx.world, ctx.playerId);
  if (roomId === undefined) {
    return no('You are nowhere.');
  }
  return {
    args: [{ entity: roomId }, { entity: ctx.playerId }],
    message: 'look',
    to: { service: 'room' }
  };
};

const movePlan = (ctx: ActionContext): Plan => {
  const plan = planMove(ctx);
  if (plan.kind === 'refused') {
    return plan;
  }
  return {
    args: [
      { entity: plan.exitId },
      { entity: ctx.playerId },
      { entity: plan.from },
      { entity: plan.to }
    ],
    message: 'traverse',
    to: { service: 'exit' }
  };
};

const PLANS: Record<string, (ctx: ActionContext) => Plan> = {
  look: lookPlan,
  move: movePlan
};

/** Is this verb's action a Script? */
export const isScripted = (verb: string) => verb in PLANS;

/**
 * What to send for a scripted action, or why it can't happen. Ask this
 * before the action runs: once it has, the world has changed (the actor has
 * moved), so the plan would differ.
 */
export const planScripted = (ctx: ActionContext): Plan | undefined =>
  PLANS[ctx.verb]?.(ctx);

/**
 * A scripted action's outcome from its reply, with the room the actor now
 * sees for clients to show.
 */
export const scriptedOutcome = (
  ctx: ActionContext,
  message: string
): ActionOutcome => ({
  kind: 'done',
  message,
  room: roomViewFor(ctx.world, ctx.playerId)
});
