import { toDirection, type Reach, type Vocabulary } from './verbs';

/**
 * A command parsed from what a Character typed, as
 * `MuaWorld.Commands.Parser` gives it: the handler of the matched form, its
 * noun phrases with articles removed and where to look for them, and any
 * Direction or text.
 */
export type ParsedCommand = {
  direction?: string;
  indirect?: string;
  indirectReach?: Reach;
  raw: string;
  target?: string;
  targetReach?: Reach;
  text?: string;
  verb: string;
};

export type ParseResult =
  { command: ParsedCommand; ok: true } | { message: string; ok: false };

type Token = [word: string, start: number];
type Captures = Partial<
  Pick<ParsedCommand, 'direction' | 'indirect' | 'target' | 'text'>
>;

const error = (message: string): ParseResult => ({ message, ok: false });

/** Parses a line against a vocabulary */
export const parse = (raw: string, vocabulary: Vocabulary): ParseResult => {
  const input = expandSay(raw);
  const tokens = tokenize(input);
  const [head, ...args] = tokens;
  if (!head) {
    return error('Please enter a command.');
  }
  const [first] = head;

  // A direction on its own means "go <direction>"
  const direction = args.length === 0 ? toDirection(vocabulary, first) : null;
  if (direction) {
    return { command: { direction, raw, verb: 'move' }, ok: true };
  }
  const verb = vocabulary.byName.get(first);
  if (!verb) {
    return error(`Unknown command: "${first}"`);
  }

  for (const form of verb.forms) {
    const slots = form.pattern.split(/\s+/).filter(Boolean);
    const captures = match(vocabulary, slots, args, input);
    if (captures) {
      const command: ParsedCommand = { ...captures, raw, verb: form.handler };
      if (command.target !== undefined) {
        command.targetReach = form.reach ?? 'here';
      }
      if (command.indirect !== undefined) {
        command.indirectReach = form.indirectReach ?? 'here';
      }
      return { command, ok: true };
    }
  }
  return error(verb.incomplete ?? `I don't understand "${input.trim()}".`);
};

// Tokens are lowercased words with their offset into the input
const tokenize = (input: string): Token[] =>
  [...input.matchAll(/\S+/g)].map(m => [m[0].toLowerCase(), m.index]);

// Noun phrases are tried shortest first, so a following preposition can
// still match: in `obj in obj2`, `red box in bag` gives `red box` and `bag`.
const match = (
  v: Vocabulary,
  slots: string[],
  tokens: Token[],
  input: string
): Captures | null => {
  const [slot, ...rest] = slots;
  const [token, ...after] = tokens;
  if (slot === undefined) {
    return token === undefined ? {} : null;
  }
  if (token === undefined) {
    return null;
  }

  if (slot === 'dir') {
    const direction = toDirection(v, token[0]);
    const captures = direction ? match(v, rest, after, input) : null;
    return captures && direction ? { ...captures, direction } : null;
  }
  if (slot === 'text') {
    return rest.length === 0 ? { text: input.slice(token[1]).trim() } : null;
  }
  if (slot === 'obj' || slot === 'obj2') {
    for (let n = 1; n <= tokens.length; n++) {
      const phrase = nounPhrase(v, tokens.slice(0, n));
      const captures =
        phrase === null ? null : match(v, rest, tokens.slice(n), input);
      if (captures && phrase !== null) {
        return {
          ...captures,
          [slot === 'obj' ? 'target' : 'indirect']: phrase
        };
      }
    }
    return null;
  }
  return slot === token[0] ? match(v, rest, after, input) : null;
};

const nounPhrase = (v: Vocabulary, tokens: Token[]) => {
  const words = tokens.map(([w]) => w).filter(w => !v.articles.includes(w));
  return words.length === 0 ? null : words.join(' ');
};

// A leading `'` or `"` says the rest: `'hello` and `"hello"` say hello
const expandSay = (input: string) => {
  const said = /^\s*(["'])(.*?)\1?\s*$/s.exec(input);
  return said ? `say ${said[2]}` : input;
};
