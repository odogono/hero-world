import { createSystem } from 'odgn-ecs/system';

export const createOutputSystem = (connections: Map<string, any>) => createSystem(
    ({ entity, world }) => {
      if (!entity.outputEvent) {return;}

      const { broadcast, message, roomId, wsId } = entity.outputEvent;

      if (broadcast && roomId) {
        // Send to all players in room
        const playersInRoom = world.queryAll({
          args: [roomId],
          where: 'player.location = ?1',
          with: ['player']
        });

        playersInRoom.forEach(player => {
          if (player.player.connectedId) {
            const conn = world.get(player.player.connectedId);
            if (conn?.connected) {
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
      world.remove(entity.id);
    },
    {
      frequency: 1,
      priority: 40,
      with: ['outputEvent']
    }
  );
