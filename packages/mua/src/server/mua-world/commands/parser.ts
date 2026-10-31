import { directionAliases, directions, verbAliases } from './registry';
import type { CommandParseResult } from './types';

export const parseCommand = (input: string): CommandParseResult => {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { error: 'Please enter a command.', success: false };
  }

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0]!;
  const verb = verbAliases[firstToken] ?? firstToken;

  // Handle standalone directions (e.g., "north" → "move north")
  if (directions.includes(firstToken) || directionAliases[firstToken]) {
    const direction = directionAliases[firstToken] ?? firstToken;
    return {
      command: { direction, rawInput: input, verb: 'move' },
      success: true
    };
  }

  const restTokens = tokens.slice(1);

  switch (verb) {
    case 'move': {
      const direction = directionAliases[restTokens[0]!] ?? restTokens[0];
      if (!direction || !directions.includes(direction)) {
        return { error: 'Where do you want to go?', success: false };
      }
      return { command: { direction, rawInput: input, verb }, success: true };
    }

    case 'look':
      return {
        command: {
          rawInput: input,
          target: restTokens.join(' ') || undefined,
          verb
        },
        success: true
      };

    default:
      return { error: `Unknown command: "${firstToken}"`, success: false };
  }
};
