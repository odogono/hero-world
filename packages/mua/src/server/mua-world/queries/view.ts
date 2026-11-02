import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { RoomView } from '../actions/types';
import type { MuaComponents } from '../coms';
import { isClosed } from './doors';
import { getEntity, getLocationOf } from './entity';
import { findNpcsIn, findPlayersIn } from './player';
import { getRoomContents, getRoomExits } from './room';

/**
 * What a player can see of the room they are in, for clients to show
 * alongside the text of `look`. The text itself comes from the room Service
 * (behaviours/lib/rooms.talk), which picks the same things.
 */
export const roomViewFor = (
  world: World<MuaComponents>,
  playerId: EntityId
): RoomView | undefined => {
  const room = getEntity(world, getLocationOf(world, playerId), ['described']);
  if (!room) {
    return undefined;
  }
  const contents = getRoomContents(world, room.id);
  return {
    description: room.described.description,
    exits: getRoomExits(world, room.id).map(e =>
      isClosed(world, e.portal.door ?? undefined)
        ? `${e.portal.dir} (closed)`
        : e.portal.dir
    ),
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
};
