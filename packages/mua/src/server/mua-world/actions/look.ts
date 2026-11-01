import { getEntity, getLocationOf } from '../queries/entity';
import { findPlayersIn } from '../queries/player';
import { getRoomContents, getRoomExits } from '../queries/room';
import type { ActionContext, ActionResult } from './types';

export const lookAction = (ctx: ActionContext): ActionResult => {
  const { playerId, world } = ctx;
  const roomId = getLocationOf(world, playerId);
  if (roomId === undefined) {
    return { message: 'You are nowhere.' };
  }

  const room = getEntity(world, roomId, ['described']);
  if (!room) {
    return { message: 'You are in darkness.' };
  }

  let message = `\n${room.described.name}\n${room.described.description}\n`;

  // List contents
  const contents = getRoomContents(world, room.id);
  if (contents.length > 0) {
    const items = contents.filter(e => e.item);
    const containers = contents.filter(e => e.container);

    if (items.length > 0) {
      message += `\nYou see: ${items.map(i => i.described.name).join(', ')}`;
    }
    if (containers.length > 0) {
      message += `\nThere is: ${containers.map(c => c.described.name).join(', ')}`;
    }
  }

  const others = findPlayersIn(world, room.id).filter(p => p.id !== playerId);
  if (others.length > 0) {
    message += `\nAlso here: ${others.map(p => p.player.name).join(', ')}`;
  }

  // List exits
  const exits = getRoomExits(world, room.id);
  if (exits.length > 0) {
    message += `\n\nExits: ${exits.map(e => e.portal.dir).join(', ')}`;
  }

  return { message };
};
