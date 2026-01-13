import { createSystem } from 'odgn-ecs/system';
import { parseCommand } from '../commands/parser';
import { findPlayerByConnection } from '../queries/player';

export const parseSystem = createSystem(
  ({ entity, world }) => {
    if (!entity.inputEvent) {return;}

    const { text, wsId } = entity.inputEvent;

    // Find player for this connection
    const player = findPlayerByConnection(world, wsId);

    if (!player) {
      // Create output event with error
      world.create({
        outputEvent: {
          broadcast: false,
          message: 'Player not found. Please login.',
          wsId
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
          broadcast: false,
          message: parseResult.error,
          wsId
        }
      });
      world.remove(entity.id);
      return;
    }

    // Create command event
    const { direction, rawInput, target, verb } = parseResult.command;
    world.create({
      commandEvent: {
        direction,
        playerId: player.id,
        rawInput,
        target,
        verb
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
