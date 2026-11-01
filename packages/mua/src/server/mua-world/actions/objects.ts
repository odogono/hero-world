import type { EntityId } from 'odgn-ecs/types';

import { getEntity, getLocationOf } from '../queries/entity';
import { getElements, theName } from '../queries/scope';
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

const actorName = (ctx: ActionContext) =>
  getEntity(ctx.world, ctx.playerId, ['player'])?.player.name ?? 'Someone';

const roomOf = (ctx: ActionContext) => getLocationOf(ctx.world, ctx.playerId);

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

  const roomId = roomOf(ctx);
  return {
    broadcast:
      roomId === undefined
        ? undefined
        : {
            exclude: playerId,
            message: `${actorName(ctx)} takes ${nameOf(ctx, target.id)}.`,
            roomId
          },
    kind: 'done',
    message: 'Taken.'
  };
};

export const dropAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location'], true);
  const roomId = roomOf(ctx);
  if (!target || roomId === undefined) {
    return refused('Drop what?');
  }

  target.location = { in: roomId };
  world.flush();

  return {
    broadcast: {
      exclude: playerId,
      message: `${actorName(ctx)} drops ${nameOf(ctx, target.id)}.`,
      roomId
    },
    kind: 'done',
    message: 'Dropped.'
  };
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

  const roomId = roomOf(ctx);
  const result = {
    broadcast:
      roomId === undefined
        ? undefined
        : {
            exclude: playerId,
            message: `${actorName(ctx)} ${verb}s ${name}.`,
            roomId
          },
    kind: 'done' as const,
    message: isClosed ? 'Closed.' : 'Opened.'
  };
  if (!isClosed) {
    const inside = getElements(world, target.id);
    if (inside.length > 0) {
      result.message = `Opening ${name} reveals: ${listNames(inside)}.`;
    }
  }
  return result;
};

export const openAction = (ctx: ActionContext) => setClosed(ctx, false);
export const closeAction = (ctx: ActionContext) => setClosed(ctx, true);
