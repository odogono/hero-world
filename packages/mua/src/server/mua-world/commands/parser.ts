import { verbAliases, directionAliases, directions } from './registry';
import type { CommandParseResult, ParsedCommand } from './types';

export const parseCommand = (input: string): CommandParseResult => {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { success: false, error: 'Please enter a command.' };
  }

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0]!;
  const verb = verbAliases[firstToken] ?? firstToken;

  // Handle standalone directions (e.g., "north" → "move north")
  if (directions.includes(firstToken) || directionAliases[firstToken]) {
    const direction = directionAliases[firstToken] ?? firstToken;
    return {
      success: true,
      command: { verb: 'move', direction, rawInput: input }
    };
  }

  const restTokens = tokens.slice(1);

  switch (verb) {
    case 'move': {
      const direction = directionAliases[restTokens[0]!] ?? restTokens[0];
      if (!direction || !directions.includes(direction)) {
        return { success: false, error: 'Where do you want to go?' };
      }
      return { success: true, command: { verb, direction, rawInput: input } };
    }

    case 'look':
      return {
        success: true,
        command: {
          verb,
          target: restTokens.join(' ') || undefined,
          rawInput: input
        }
      };

    default:
      return { success: false, error: `Unknown command: "${firstToken}"` };
  }
};
