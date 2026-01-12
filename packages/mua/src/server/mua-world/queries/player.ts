import type { World } from 'odgn-ecs/types';

export const findPlayerByConnection = (world: World<any>, wsId: string) => {
  return world.query({
    with: ['player'],
    where: `player.connected_id IN (
      SELECT id FROM entity WHERE id IN (
        SELECT id FROM connected WHERE connected.ws_id = ?1
      )
    )`,
    args: [wsId]
  });
};

export const findPlayerByName = (world: World<any>, name: string) => {
  return world.query({
    with: ['player'],
    where: 'player.name = ?1',
    args: [name]
  });
};
