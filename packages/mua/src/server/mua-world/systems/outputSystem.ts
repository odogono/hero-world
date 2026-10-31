import { createSystem } from 'odgn-ecs/system';

import type { MuaConnection } from '../index';

export const createOutputSystem = (connections: Map<string, MuaConnection>) =>
  createSystem(
    ({ entity, world }) => {
      if (!entity.outputEvent) {
        return;
      }

      const { broadcast, message, roomId, wsId } = entity.outputEvent;

      if (broadcast && roomId) {
        // Send to all players in room
        const playersInRoom = world.queryAll({
          args: [roomId],
          where: 'location."in" = ?1',
          with: ['player', 'location']
        });

        playersInRoom.forEach(player => {
          if (player.player.connectedId) {
            const conn = world.query({
              entity: { id: player.player.connectedId, world } as never,
              with: ['connected']
            });
            if (conn) {
              const ws = connections.get(conn.connected.wsId);
              if (ws) {
                ws.send(JSON.stringify({ data: message, success: true }));
              }
            }
          }
        });
      } else {
        // Send to specific connection
        const ws = connections.get(wsId);
        if (ws) {
          ws.send(JSON.stringify({ data: message, success: true }));
        }
      }

      // Remove output event
      world.delete(entity);
    },
    {
      frequency: 1,
      priority: 40,
      with: ['outputEvent']
    }
  );
