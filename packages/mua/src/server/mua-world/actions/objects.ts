import type { EntityId } from 'odgn-ecs/types';

import { getEntity, getLocationOf } from '../queries/entity';
import { getElements, theName } from '../queries/scope';
import { messageFor } from './messages';
import { done, refused, type ActionContext, type ActionOutcome } from './types';

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const listNames = (ids: { isPlayer: boolean; name: string }[]) =>
  ids.map(theName).join(', ');

/** Name, description and, for an open container, what is inside */
export const examineAction = (ctx: ActionContext): ActionOutcome => {
  const { targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location']);
  if (!target) {
    return refused('Examine what?');
  }
  const described = getEntity(world, targetId, ['described']);
  const player = getEntity(world, targetId, ['player']);
  const container = getEntity(world, targetId, ['container']);

  const lines = [
    described?.described.description ??
      (player ? `You see ${player.player.name}.` : 'You see nothing special.')
  ];

  if (container && !player) {
    if (container.container.isClosed) {
      lines.push('It is closed.');
    } else {
      const inside = getElements(world, container.id);
      lines.push(
        inside.length > 0
          ? `It contains: ${listNames(inside)}.`
          : 'It is empty.'
      );
    }
  }
  return done(lines.join('\n'));
};

const nameOf = (ctx: ActionContext, id: EntityId) => {
  const described = getEntity(ctx.world, id, ['described']);
  return theName({ isPlayer: false, name: described?.described.name ?? 'it' });
};

/**
 * Finishes a built-in action with its messages: `msg` for the actor (or
 * `message` when given) and `omsg` for everyone else in the room.
 */
const report = (
  ctx: ActionContext,
  handler: string,
  message?: string
): ActionOutcome => {
  const roomId = getLocationOf(ctx.world, ctx.playerId);
  const others = messageFor(ctx, handler, 'omsg');
  return {
    broadcasts:
      roomId === undefined || !others
        ? undefined
        : [{ exclude: ctx.playerId, message: others, to: roomId }],
    kind: 'done',
    message: message ?? messageFor(ctx, handler, 'msg') ?? ''
  };
};

export const takeAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location'], true);
  if (!target) {
    return refused('Take what?');
  }
  if (target.location.in === playerId) {
    return refused('You already have that.');
  }
  if (getEntity(world, target.id, ['player'])) {
    return refused("You can't take people.");
  }
  const item = getEntity(world, target.id, ['item']);
  if (!item?.item.isTakeable) {
    return refused("You can't take that.");
  }

  target.location = { in: playerId };
  world.flush();

  return report(ctx, 'take');
};

export const dropAction = (ctx: ActionContext): ActionOutcome => {
  const { targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location'], true);
  const roomId = getLocationOf(world, ctx.playerId);
  if (!target || roomId === undefined) {
    return refused('Drop what?');
  }

  target.location = { in: roomId };
  world.flush();

  return report(ctx, 'drop');
};

export const inventoryAction = (ctx: ActionContext): ActionOutcome => {
  const carried = getElements(ctx.world, ctx.playerId);
  return {
    kind: 'done',
    message:
      carried.length > 0
        ? `You are carrying: ${listNames(carried)}.`
        : 'You are empty-handed.'
  };
};

const setClosed = (ctx: ActionContext, isClosed: boolean): ActionOutcome => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['container'], true);
  const verb = isClosed ? 'close' : 'open';
  if (!target || getEntity(world, target.id, ['player'])) {
    return refused(`You can't ${verb} that.`);
  }
  const name = nameOf(ctx, target.id);
  if (target.container.isClosed === isClosed) {
    return refused(
      `${capitalise(name)} is already ${isClosed ? 'closed' : 'open'}.`
    );
  }

  target.container = { ...target.container, isClosed };
  world.flush();

  const inside = isClosed ? [] : getElements(world, target.id);
  return report(
    ctx,
    verb,
    inside.length > 0
      ? `Opening ${name} reveals: ${listNames(inside)}.`
      : undefined
  );
};

export const openAction = (ctx: ActionContext) => setClosed(ctx, false);
export const closeAction = (ctx: ActionContext) => setClosed(ctx, true);
