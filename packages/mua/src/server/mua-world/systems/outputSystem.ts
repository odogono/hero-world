import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import type { MuaConnection } from '../index';
import { getEntity } from '../queries/entity';
import { findPlayersIn } from '../queries/player';
import { createMuaSystem } from './create-mua-system';

/** The connections that hear something said to an entity */
const listenersOf = (
  world: World<MuaComponents>,
  to: EntityId,
  exclude: EntityId | undefined
) => {
  const player = getEntity(world, to, ['player']);
  const players = player ? [player] : findPlayersIn(world, to);
  return players
    .filter(p => p.id !== exclude)
    .map(p => getEntity(world, p.player.connectedId, ['connected']))
    .map(conn => conn?.connected.wsId)
    .filter(Boolean);
};

export const createOutputSystem = (connections: Map<string, MuaConnection>) =>
  createMuaSystem(
    ({ entity, world }) => {
      if (!entity.outputEvent) {
        return;
      }

      const { exclude, message, room, to, wsId } = entity.outputEvent;
      // a room view rides along with the text for clients that show it
      const payload = JSON.stringify({
        data: message,
        ...(room ? { room } : {}),
        success: true
      });

      const wsIds =
        to === undefined || to === null
          ? [wsId]
          : listenersOf(world, to, exclude ?? undefined);
      for (const id of wsIds) {
        if (id) {
          connections.get(id)?.send(payload);
        }
      }

      world.delete(entity);
    },
    {
      frequency: 1,
      priority: 10,
      with: ['outputEvent']
    }
  );
