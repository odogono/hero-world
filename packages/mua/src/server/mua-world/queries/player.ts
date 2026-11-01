import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export const findConnectionByWsId = (
  world: World<MuaComponents>,
  wsId: string
) =>
  world.query({
    args: [wsId],
    where: 'connected.ws_id = ?1',
    with: ['connected']
  });

export const findPlayerByConnection = (
  world: World<MuaComponents>,
  wsId: string,
  asProxy = false
) => {
  const connection = findConnectionByWsId(world, wsId);
  if (!connection) {
    return undefined;
  }
  return world.query({
    args: [connection.id],
    asProxy,
    where: 'player.connected_id = ?1',
    with: ['player']
  });
};

export const findPlayerByName = (world: World<MuaComponents>, name: string) =>
  world.query({
    args: [name],
    asProxy: true,
    where: 'player.name = ?1',
    with: ['player']
  });

/** Players located in the given entity, with the connection they play from. */
export const findPlayersIn = (world: World<MuaComponents>, placeId: number) =>
  world.queryAll({
    args: [placeId],
    where: 'location.in = ?1',
    with: ['player', 'location']
  });
