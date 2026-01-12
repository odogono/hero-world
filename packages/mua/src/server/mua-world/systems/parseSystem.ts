import { createSystem } from 'odgn-ecs/system';
import { parseCommand } from '../commands/parser';
import { findPlayerByConnection } from '../queries/player';

export const parseSystem = createSystem(
  ({ world, entity }) => {
    if (!entity.inputEvent) return;

    const { wsId, text } = entity.inputEvent;

    // Find player for this connection
    const player = findPlayerByConnection(world, wsId);

    if (!player) {
      // Create output event with error
      world.create({
        outputEvent: {
          wsId,
          message: 'Player not found. Please login.',
          broadcast: false
        }
      });
      world.remove(entity.id);
      return;
    }

    // Parse command
    const parseResult = parseCommand(text);

    if (!parseResult.success) {
      // Create output event with parse error
      world.create({
        outputEvent: {
          wsId,
          message: parseResult.error,
          broadcast: false
        }
      });
      world.remove(entity.id);
      return;
    }

    // Create command event
    const { verb, target, direction, rawInput } = parseResult.command;
    world.create({
      commandEvent: {
        playerId: player.id,
        verb,
        target,
        direction,
        rawInput
      }
    });

    // Remove input event
    world.remove(entity.id);
  },
  {
    frequency: 1,
    priority: 20,
    with: ['inputEvent']
  }
);
