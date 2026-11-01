import type { CommandParseResult, ParsedCommand } from './types';
import {
  ARTICLES,
  DIRECTIONS,
  DIRECTION_ALIASES,
  VERBS,
  type VerbDef,
  type VerbForm
} from './verbs';

type Token = { end: number; start: number; word: string };

type Captures = Pick<
  ParsedCommand,
  'direction' | 'indirect' | 'target' | 'text'
>;

const verbsByName = new Map<string, VerbDef>(
  VERBS.flatMap(def => def.names.map(name => [name, def] as const))
);

const tokenize = (input: string): Token[] =>
  [...input.matchAll(/\S+/g)].map(match => ({
    end: match.index + match[0].length,
    start: match.index,
    word: match[0].toLowerCase()
  }));

const toDirection = (word: string | undefined) => {
  if (word === undefined) {
    return undefined;
  }
  const direction = DIRECTION_ALIASES[word] ?? word;
  return (DIRECTIONS as readonly string[]).includes(direction)
    ? direction
    : undefined;
};

const toNounPhrase = (tokens: Token[]) => {
  const words = tokens.map(t => t.word).filter(w => !ARTICLES.includes(w));
  return words.length > 0 ? words.join(' ') : undefined;
};

/**
 * Matches the argument tokens against a form's pattern. Noun phrases are
 * tried shortest first so that a following preposition can still match:
 * in `obj in obj2`, `red box in bag` gives `red box` and `bag`.
 */
const matchPattern = (
  slots: string[],
  tokens: Token[],
  input: string
): Captures | undefined => {
  const [slot, ...restSlots] = slots;

  if (slot === undefined) {
    return tokens.length === 0 ? {} : undefined;
  }
  const [first] = tokens;
  if (first === undefined) {
    return undefined;
  }

  switch (slot) {
    case 'dir': {
      const direction = toDirection(first.word);
      if (!direction) {
        return undefined;
      }
      const rest = matchPattern(restSlots, tokens.slice(1), input);
      return rest && { ...rest, direction };
    }
    case 'text':
      // text always takes everything that is left
      return restSlots.length === 0
        ? { text: input.slice(first.start).trim() }
        : undefined;
    case 'obj':
    case 'obj2': {
      for (let end = 1; end <= tokens.length; end++) {
        const phrase = toNounPhrase(tokens.slice(0, end));
        if (!phrase) {
          continue;
        }
        const rest = matchPattern(restSlots, tokens.slice(end), input);
        if (rest) {
          return slot === 'obj'
            ? { ...rest, target: phrase }
            : { ...rest, indirect: phrase };
        }
      }
      return undefined;
    }
    default: {
      // a literal word, such as a preposition
      if (first.word !== slot) {
        return undefined;
      }
      return matchPattern(restSlots, tokens.slice(1), input);
    }
  }
};

const matchForm = (form: VerbForm, args: Token[], input: string) => {
  const slots = form.pattern.split(/\s+/).filter(Boolean);
  return matchPattern(slots, args, input);
};

/**
 * Splits off a leading `'` or `"` so that `'hello` and `"hello"` say hello.
 */
const expandSayShorthand = (input: string) => {
  const match = /^\s*(["'])(.*?)\1?\s*$/.exec(input);
  return match ? `say ${match[2]}` : input;
};

export const parseCommand = (rawInput: string): CommandParseResult => {
  const input = expandSayShorthand(rawInput);
  const tokens = tokenize(input);
  const [first, ...args] = tokens;

  if (first === undefined) {
    return { error: 'Please enter a command.', success: false };
  }

  // A direction on its own means "go <direction>"
  const direction = args.length === 0 ? toDirection(first.word) : undefined;
  if (direction) {
    return {
      command: { direction, rawInput, verb: 'move' },
      success: true
    };
  }

  const verb = verbsByName.get(first.word);
  if (!verb) {
    return { error: `Unknown command: "${first.word}"`, success: false };
  }

  for (const form of verb.forms) {
    const captures = matchForm(form, args, input);
    if (captures) {
      return {
        command: {
          ...captures,
          ...(captures.target === undefined
            ? {}
            : { targetScope: form.scope ?? 'here' }),
          ...(captures.indirect === undefined
            ? {}
            : { indirectScope: form.indirectScope ?? 'here' }),
          rawInput,
          verb: form.handler
        },
        success: true
      };
    }
  }

  return {
    error: verb.incomplete ?? `I don't understand "${input.trim()}".`,
    success: false
  };
};
