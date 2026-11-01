import type { EntityId } from 'odgn-ecs/types';

import { getEntity, getLocationOf } from '../queries/entity';
import { getElements, theName } from '../queries/scope';
import type { ActionContext, ActionResult } from './types';

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const listNames = (ids: { isPlayer: boolean; name: string }[]) =>
  ids.map(theName).join(', ');

/** Name, description and, for an open container, what is inside */
export const examineAction = (ctx: ActionContext): ActionResult => {
  const { targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location']);
  if (!target) {
    return { message: 'Examine what?' };
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
  return { message: lines.join('\n') };
};

const nameOf = (ctx: ActionContext, id: EntityId) => {
  const described = getEntity(ctx.world, id, ['described']);
  return theName({ isPlayer: false, name: described?.described.name ?? 'it' });
};

const actorName = (ctx: ActionContext) =>
  getEntity(ctx.world, ctx.playerId, ['player'])?.player.name ?? 'Someone';

const roomOf = (ctx: ActionContext) => getLocationOf(ctx.world, ctx.playerId);

export const takeAction = (ctx: ActionContext): ActionResult => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location'], true);
  if (!target) {
    return { message: 'Take what?' };
  }
  if (target.location.in === playerId) {
    return { message: 'You already have that.' };
  }
  if (getEntity(world, target.id, ['player'])) {
    return { message: "You can't take people." };
  }
  const item = getEntity(world, target.id, ['item']);
  if (!item?.item.isTakeable) {
    return { message: "You can't take that." };
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
    message: 'Taken.'
  };
};

export const dropAction = (ctx: ActionContext): ActionResult => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['location'], true);
  const roomId = roomOf(ctx);
  if (!target || roomId === undefined) {
    return { message: 'Drop what?' };
  }

  target.location = { in: roomId };
  world.flush();

  return {
    broadcast: {
      exclude: playerId,
      message: `${actorName(ctx)} drops ${nameOf(ctx, target.id)}.`,
      roomId
    },
    message: 'Dropped.'
  };
};

export const inventoryAction = (ctx: ActionContext): ActionResult => {
  const carried = getElements(ctx.world, ctx.playerId);
  return {
    message:
      carried.length > 0
        ? `You are carrying: ${listNames(carried)}.`
        : 'You are empty-handed.'
  };
};

const setClosed = (ctx: ActionContext, isClosed: boolean): ActionResult => {
  const { playerId, targetId, world } = ctx;
  const target = getEntity(world, targetId, ['container'], true);
  const verb = isClosed ? 'close' : 'open';
  if (!target || getEntity(world, target.id, ['player'])) {
    return { message: `You can't ${verb} that.` };
  }
  const name = nameOf(ctx, target.id);
  if (target.container.isClosed === isClosed) {
    return {
      message: `${capitalise(name)} is already ${isClosed ? 'closed' : 'open'}.`
    };
  }

  target.container = { ...target.container, isClosed };
  world.flush();

  const roomId = roomOf(ctx);
  const result: ActionResult = {
    broadcast:
      roomId === undefined
        ? undefined
        : {
            exclude: playerId,
            message: `${actorName(ctx)} ${verb}s ${name}.`,
            roomId
          },
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
