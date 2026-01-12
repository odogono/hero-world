import { createSystem } from 'odgn-ecs/system';
import { executeAction } from '../actions';

export const actionSystem = createSystem(
  ({ world, entity }) => {
    if (!entity.commandEvent) return;

    const { playerId, verb, target, direction } = entity.commandEvent;

    // Execute action
    const result = executeAction({
      world,
      playerId,
      verb,
      target,
      direction
    });

    // Get player's connection
    const player = world.get(playerId);
    if (!player?.player?.connectedId) {
      world.remove(entity.id);
      return;
    }

    const connection = world.get(player.player.connectedId);
    if (!connection?.connected) {
      world.remove(entity.id);
      return;
    }

    // Create output event for player
    world.create({
      outputEvent: {
        wsId: connection.connected.wsId,
        message: result.message,
        broadcast: false
      }
    });

    // Create broadcast output event if needed
    if (result.broadcast) {
      world.create({
        outputEvent: {
          wsId: '', // Will be resolved by output system
          message: result.broadcast.message,
          broadcast: true,
          roomId: result.broadcast.roomId
        }
      });
    }

    // Update player stats
    player.player.lastCommandAt = new Date().toISOString();

    // Remove command event
    world.remove(entity.id);
  },
  {
    frequency: 1,
    priority: 30,
    with: ['commandEvent']
  }
);
