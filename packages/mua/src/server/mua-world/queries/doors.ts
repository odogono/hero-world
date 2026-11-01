import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { getEntity } from './entity';

type MuaWorld = World<MuaComponents>;

/** The doors of a room's exits, each once */
export const doorsOf = (world: MuaWorld, roomId: EntityId): EntityId[] => [
  ...new Set(
    world
      .queryAll({
        args: [roomId],
        where: 'location.in = ?1',
        with: ['location', 'portal']
      })
      .map(exit => exit.portal.door ?? undefined)
      .filter((door): door is EntityId => door !== undefined)
  )
];

/** The rooms a door joins: those with an exit through it */
export const roomsOfDoor = (world: MuaWorld, doorId: EntityId): EntityId[] => [
  ...new Set(
    world
      .queryAll({
        args: [doorId],
        where: 'portal.door = ?1',
        with: ['location', 'portal']
      })
      .map(exit => exit.location.in ?? undefined)
      .filter((room): room is EntityId => room !== undefined)
  )
];

/**
 * Whether something that opens and closes is closed: a container or a door.
 * Undefined if it neither opens nor closes.
 */
export const isClosed = (world: MuaWorld, id: EntityId | undefined) =>
  getEntity(world, id, ['container'])?.container.isClosed ??
  getEntity(world, id, ['door'])?.door.isClosed ??
  undefined;
