import { parseCommand } from '../commands/parser';
import { AGAIN_WORDS } from '../commands/verbs';
import { findPlayerByConnection } from '../queries/player';
import { createMuaSystem } from './create-mua-system';

export const parseSystem = createMuaSystem(
  ({ entity, world }) => {
    const { text, wsId } = entity.inputEvent;

    const reply = (message: string) => {
      world.create({ outputEvent: { broadcast: false, message, wsId } });
      world.delete(entity);
    };

    // Find player for this connection
    const player = findPlayerByConnection(world, wsId, true);
    if (!player) {
      reply('Player not found. Please login.');
      return;
    }

    // `again` / `g` repeats the previous command
    const isAgain = AGAIN_WORDS.includes(text.trim().toLowerCase());
    const input = isAgain ? player.player.lastInput : text;
    // unset optional fields read back from the database as null
    if (input === undefined || input === null) {
      reply('There is nothing to repeat.');
      return;
    }

    const parseResult = parseCommand(input);
    if (!parseResult.success) {
      reply(parseResult.error);
      return;
    }

    player.player.lastInput = input;

    const { direction, indirect, rawInput, target, verb } = parseResult.command;
    world.create({
      commandEvent: {
        direction,
        indirect,
        playerId: player.id,
        rawInput,
        target,
        text: parseResult.command.text,
        verb
      }
    });

    // Remove input event
    world.delete(entity);
  },
  {
    frequency: 1,
    priority: 20,
    with: ['inputEvent']
  }
);
