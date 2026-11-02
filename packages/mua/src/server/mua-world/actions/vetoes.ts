import type { EntityId } from 'odgn-ecs/types';

import { getEntity, getLocationOf } from '../queries/entity';
import type { Receiver } from '../scripts/runner';
import { takeRefusal } from './objects';
import { planMove } from './scripted';
import type { ActionContext } from './types';

/**
 * Questions asked before an action changes the world, as NorthTalk
 * Decisions. Any entity asked can veto: a fixed
 * `responses { veto: { <event>: "..." } }`, or a Script handler
 * `on <event> actor, subject, deciding` that runs `veto "reason"`. A Script
 * that passes, allows, or has no handler lets it happen.
 * - `beforeTraverse` asked of the exit Service (behaviours/exit.talk), which
 *                  vetoes when the exit's door is closed; subject: the exit
 * - `beforeExit`   asked of the room being left; subject: the room entered
 * - `beforeEnter`  asked of the room being entered; subject: the room left
 * - `beforeRemove` asked of what holds a thing about to leave it; subject:
 *                  the thing
 * - `beforeAdd`    asked of where a thing is about to go; subject: the thing
 */
export type VetoEvent =
  | 'beforeAdd'
  | 'beforeEnter'
  | 'beforeExit'
  | 'beforeRemove'
  | 'beforeTraverse';

export type VetoQuestion = {
  event: VetoEvent;
  /** Who is asked: an entity, or one of mua's Services */
  id: Receiver;
  subject: EntityId;
};

type VetoPlan = (ctx: ActionContext) => VetoQuestion[];

const moveVetoes: VetoPlan = ctx => {
  const plan = planMove(ctx);
  if (plan.kind === 'refused') {
    return [];
  }
  return [
    { event: 'beforeTraverse', id: { service: 'exit' }, subject: plan.exitId },
    { event: 'beforeExit', id: plan.from, subject: plan.to },
    { event: 'beforeEnter', id: plan.to, subject: plan.from }
  ];
};

const takeVetoes: VetoPlan = ctx => {
  const holder = getLocationOf(ctx.world, ctx.targetId);
  if (takeRefusal(ctx) || holder === undefined || ctx.targetId === undefined) {
    return [];
  }
  return [
    { event: 'beforeRemove', id: holder, subject: ctx.targetId },
    { event: 'beforeAdd', id: ctx.playerId, subject: ctx.targetId }
  ];
};

const dropVetoes: VetoPlan = ctx => {
  const target = getEntity(ctx.world, ctx.targetId, ['location']);
  const holder = target?.location.in ?? undefined;
  const roomId = getLocationOf(ctx.world, ctx.playerId);
  if (!target || holder === undefined || roomId === undefined) {
    return [];
  }
  return [
    { event: 'beforeRemove', id: holder, subject: target.id },
    { event: 'beforeAdd', id: roomId, subject: target.id }
  ];
};

const VETOES: Record<string, VetoPlan> = {
  drop: dropVetoes,
  move: moveVetoes,
  take: takeVetoes
};

/** The veto questions to ask before a built-in action runs, in order */
export const vetoesFor = (ctx: ActionContext): VetoQuestion[] =>
  VETOES[ctx.verb]?.(ctx) ?? [];
