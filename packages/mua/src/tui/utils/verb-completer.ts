/**
 * Known MUD verbs for tab completion
 */
export const KNOWN_VERBS = [
  'look',
  'l',
  'examine',
  'x',
  'move',
  'go',
  'north',
  'n',
  'south',
  's',
  'east',
  'e',
  'west',
  'w',
  'take',
  'get',
  'drop',
  'inventory',
  'i',
  'open',
  'close',
  'use',
  'help'
];

/**
 * Complete verb based on partial input
 * Returns the completed verb or null if no match
 */
export const completeVerb = (
  input: string,
  verbs: string[] = KNOWN_VERBS
): string | null => {
  const trimmed = input.trim().toLowerCase();

  // If input is empty, no completion
  if (!trimmed) {
    return null;
  }

  // Split input into words (only complete first word - the verb)
  const words = trimmed.split(/\s+/);
  const firstWord = words[0];

  // Find matching verbs
  const matches = verbs.filter(v => v.toLowerCase().startsWith(firstWord));

  if (matches.length === 0) {
    return null;
  }

  // Return first match, preserving any text after the verb
  const restOfInput = words.slice(1).join(' ');
  const completed = matches[0] + (restOfInput ? ' ' + restOfInput : '');

  return completed;
};

/**
 * Get all matching verbs for a partial input (useful for showing suggestions)
 */
export const getMatchingVerbs = (
  input: string,
  verbs: string[] = KNOWN_VERBS
): string[] => {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed) {
    return [];
  }

  const words = trimmed.split(/\s+/);
  const firstWord = words[0];

  return verbs.filter(v => v.toLowerCase().startsWith(firstWord));
};
