import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

export const findPlayerByConnection = (
  world: World<MuaComponents>,
  wsId: string
) => {
  const connection = world.query({
    args: [wsId],
    where: 'connected.ws_id = ?1',
    with: ['connected']
  });
  if (!connection) {
    return null;
  }
  return world.query({
    args: [connection.id],
    asProxy: true,
    where: 'player.connected_id = ?1',
    with: ['player']
  });
};

export const findPlayerByName = (world: World<MuaComponents>, name: string) =>
  world.query({
    args: [name],
    where: 'player.name = ?1',
    with: ['player']
  });
