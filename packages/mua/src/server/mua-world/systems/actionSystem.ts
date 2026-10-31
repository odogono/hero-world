import { createSystem } from 'odgn-ecs/system';

import { executeAction } from '../actions';

export const actionSystem = createSystem(
  ({ entity, world }) => {
    if (!entity.commandEvent) {
      return;
    }

    const { direction, playerId, target, verb } = entity.commandEvent;

    // Execute action
    const result = executeAction({
      direction,
      playerId,
      target,
      verb,
      world
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
        broadcast: false,
        message: result.message,
        wsId: connection.connected.wsId
      }
    });

    // Create broadcast output event if needed
    if (result.broadcast) {
      world.create({
        outputEvent: {
          broadcast: true,
          message: result.broadcast.message,
          roomId: result.broadcast.roomId,
          wsId: '' // Will be resolved by output system
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
