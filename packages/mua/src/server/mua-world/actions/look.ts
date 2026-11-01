import { getEntity, getLocationOf } from '../queries/entity';
import { findNpcsIn, findPlayersIn } from '../queries/player';
import { getRoomContents, getRoomExits } from '../queries/room';
import {
  refused,
  type ActionContext,
  type ActionOutcome,
  type RoomView
} from './types';

/** The room as text, in the order a player reads it */
const describeRoom = (room: RoomView, things: { containers: string[] }) => {
  let message = `\n${room.name}\n${room.description}\n`;
  const items = room.items.filter(i => !things.containers.includes(i));
  if (items.length > 0) {
    message += `\nYou see: ${items.join(', ')}`;
  }
  if (things.containers.length > 0) {
    message += `\nThere is: ${things.containers.join(', ')}`;
  }
  if (room.players.length > 0) {
    message += `\nAlso here: ${room.players.join(', ')}`;
  }
  if (room.exits.length > 0) {
    message += `\n\nExits: ${room.exits.join(', ')}`;
  }
  return message;
};

/** Describes the actor's room, as text and as a RoomView for clients */
export const lookAction = (ctx: ActionContext): ActionOutcome => {
  const { playerId, world } = ctx;
  const roomId = getLocationOf(world, playerId);
  if (roomId === undefined) {
    return refused('You are nowhere.');
  }

  const room = getEntity(world, roomId, ['described']);
  if (!room) {
    return refused('You are in darkness.');
  }

  const contents = getRoomContents(world, room.id);
  const containers = contents
    .filter(e => e.container)
    .map(c => c.described.name);
  const view: RoomView = {
    description: room.described.description,
    exits: getRoomExits(world, room.id).map(e => e.portal.dir),
    items: contents
      .filter(e => e.item || e.container)
      .map(e => e.described.name),
    name: room.described.name,
    players: [
      ...findPlayersIn(world, room.id)
        .filter(p => p.id !== playerId)
        .map(p => p.player.name),
      ...findNpcsIn(world, room.id)
        .filter(n => n.id !== playerId)
        .map(n => n.described.name)
    ]
  };

  return {
    kind: 'done',
    message: describeRoom(view, { containers }),
    room: view
  };
};
