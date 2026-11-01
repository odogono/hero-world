import type { MuaConnection } from '../index';
import { getEntity } from '../queries/entity';
import { findPlayersIn } from '../queries/player';
import { createMuaSystem } from './create-mua-system';

export const createOutputSystem = (connections: Map<string, MuaConnection>) =>
  createMuaSystem(
    ({ entity, world }) => {
      if (!entity.outputEvent) {
        return;
      }

      const { broadcast, exclude, message, room, roomId, wsId } =
        entity.outputEvent;
      // a room view rides along with the text for clients that show it
      const payload = JSON.stringify({
        data: message,
        ...(room ? { room } : {}),
        success: true
      });

      if (broadcast && roomId) {
        // Send to all players in room
        for (const player of findPlayersIn(world, roomId)) {
          if (player.id === exclude) {
            continue;
          }
          const conn = getEntity(world, player.player.connectedId, [
            'connected'
          ]);
          const ws = conn && connections.get(conn.connected.wsId);
          ws?.send(payload);
        }
      } else {
        // Send to specific connection
        const ws = connections.get(wsId);
        if (ws) {
          ws.send(payload);
        }
      }

      // Remove output event
      world.delete(entity);
    },
    {
      frequency: 1,
      priority: 10,
      with: ['outputEvent']
    }
  );
