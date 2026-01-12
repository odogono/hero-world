import { createSystem } from 'odgn-ecs/system';

export const createOutputSystem = (connections: Map<string, any>) => {
  return createSystem(
    ({ world, entity }) => {
      if (!entity.outputEvent) return;

      const { wsId, message, broadcast, roomId } = entity.outputEvent;

      if (broadcast && roomId) {
        // Send to all players in room
        const playersInRoom = world.queryAll({
          with: ['player'],
          where: 'player.location = ?1',
          args: [roomId]
        });

        playersInRoom.forEach((player) => {
          if (player.player.connectedId) {
            const conn = world.get(player.player.connectedId);
            if (conn?.connected) {
              const ws = connections.get(conn.connected.wsId);
              if (ws) {
                ws.send(JSON.stringify({ success: true, data: message }));
              }
            }
          }
        });
      } else {
        // Send to specific connection
        const ws = connections.get(wsId);
        if (ws) {
          ws.send(JSON.stringify({ success: true, data: message }));
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
};
