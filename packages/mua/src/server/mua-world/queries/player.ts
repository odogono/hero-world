import type { World } from 'odgn-ecs/types';

export const findPlayerByConnection = (world: World<any>, wsId: string) => world.query({
    args: [wsId],
    where: `player.connected_id IN (
      SELECT id FROM entity WHERE id IN (
        SELECT id FROM connected WHERE connected.ws_id = ?1
      )
    )`,
    with: ['player']
  });

export const findPlayerByName = (world: World<any>, name: string) => world.query({
    args: [name],
    where: 'player.name = ?1',
    with: ['player']
  });
