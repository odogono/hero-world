import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { RoomView } from '../actions/types';
import type { MuaComponents } from '../coms';

export type TellOptions = {
  /** A player inside `to` who should not hear it */
  exclude?: EntityId;
  /** A room view for clients to show alongside the text */
  room?: RoomView;
};

/**
 * Tells an entity something: a player hears it themselves; any other entity
 * (a room, a box) passes it to the players inside it.
 */
export const tell = (
  world: World<MuaComponents>,
  to: EntityId,
  message: string,
  { exclude, room }: TellOptions = {}
) => {
  world.create({ outputEvent: { exclude, message, room, to } });
};
