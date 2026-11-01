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

      const { broadcast, exclude, message, roomId, wsId } = entity.outputEvent;

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
          ws?.send(JSON.stringify({ data: message, success: true }));
        }
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
