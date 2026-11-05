import type { Eid, Store } from 'odgn-ecs/store';

import type { ParsedCommand } from './parser';
import { elements, inReach, theName, type Candidate } from './scope';
import type { Reach } from './verbs';

/**
 * Binds a parsed command's noun phrases to the entities they name, as
 * `MuaWorld.Commands.Bind` does. A phrase handles `all`, `all except X`,
 * `X and Y`, `X in Y`, `it`, and adjectives before the noun. A phrase that
 * names several objects expands into one command each, labelled with the
 * object's name.
 */

export type Slot = 'indirect' | 'target';

export type BoundCommand = ParsedCommand & {
  indirectId: Eid | null;
  /** The object's name, when a phrase named several */
  label: string | null;
  targetId: Eid | null;
};

/**
 * A command waiting for "which do you mean?", kept in `player.pending` as
 * JSON with the same keys the Elixir Host writes
 */
export type Pending = {
  command: Record<string, string>;
  options: { id: Eid; name: string }[];
  resolved: Partial<Record<Slot, Eid>>;
  slot: Slot;
};

export type BindResult =
  | { commands: BoundCommand[]; kind: 'bound' }
  | { kind: 'ambiguous'; message: string; pending: Pending }
  | { kind: 'error'; message: string };

type PhraseResult =
  | { candidates: Candidate[]; kind: 'ambiguous' | 'many' }
  | { kind: 'error'; message: string };

type Context = { actor: Eid; pool: Candidate[]; reach: Reach; store: Store };

const ALL = ['all', 'everything'];
const EXCEPT = ['but', 'except'];
const INSIDE = ['from', 'in', 'inside'];
const PRONOUNS = ['it', 'that'];

const fail = (message: string) => ({ kind: 'error', message }) as const;

/** Whether a candidate answers to these words: every word must be one of its */
export const matches = (candidate: { words: string[] }, words: string[]) =>
  words.length > 0 && words.every(w => candidate.words.includes(w));

/**
 * Binds `command` for `actor`. `lastTarget` is what `it` refers to, and
 * `resolved` holds objects already chosen, by slot.
 */
export const bind = (
  store: Store,
  actor: Eid,
  command: ParsedCommand,
  lastTarget: Eid | null = null,
  resolved: Partial<Record<Slot, Eid>> = {}
): BindResult => {
  const ids: Partial<Record<Slot, Candidate[]>> = {};
  for (const slot of ['target', 'indirect'] as const) {
    const phrase = command[slot];
    if (phrase === undefined) {
      continue;
    }
    const reach =
      (slot === 'target' ? command.targetReach : command.indirectReach) ??
      'here';
    const pool = inReach(store, actor, reach);
    const chosen = resolved[slot];

    if (chosen === undefined) {
      const ctx = { actor, pool, reach, store };
      const result = bindPhrase(ctx, phrase.split(/\s+/), lastTarget);
      if (result.kind === 'error') {
        return result;
      }
      if (result.kind === 'ambiguous') {
        const { candidates } = result;
        return {
          kind: 'ambiguous',
          message: `Which do you mean: ${describeList(candidates)}?`,
          pending: {
            command: encode(command),
            options: candidates.map(({ id, name }) => ({ id, name })),
            resolved,
            slot
          }
        };
      }
      ids[slot] = result.candidates;
    } else {
      const candidate = pool.find(c => c.id === chosen);
      if (!candidate) {
        return fail('That is no longer here.');
      }
      ids[slot] = [candidate];
    }
  }

  const targets: (Candidate | null)[] = ids.target ?? [null];
  const indirect = ids.indirect?.[0] ?? null;
  const many = targets.length > 1;
  return {
    commands: targets.map(target => ({
      ...command,
      indirectId: indirect?.id ?? null,
      label: many && target ? target.name : null,
      targetId: target?.id ?? null
    })),
    kind: 'bound'
  };
};

const splitOn = (
  words: string[],
  separators: string[]
): [string[], string[]] | null => {
  const i = words.findIndex(w => separators.includes(w));
  return i === -1 ? null : [words.slice(0, i), words.slice(i + 1)];
};

const both = (split: [string[], string[]] | null) =>
  split !== null && split[0].length > 0 && split[1].length > 0;

const uniqueById = (list: Candidate[]) =>
  list.filter((c, i) => list.findIndex(o => o.id === c.id) === i);

const bindAll = (
  ctx: Context,
  words: string[],
  lastTarget: Eid | null
): PhraseResult => {
  // `take all` means what's around you; `drop all` what you carry
  let candidates = ctx.pool.filter(
    c => !c.isPlayer && (ctx.reach === 'carried' || c.location !== ctx.actor)
  );
  const except = splitOn(words, EXCEPT);
  if (except && except[1].length > 0) {
    const excluded = bindPhrase(ctx, except[1], lastTarget);
    if (excluded.kind === 'error') {
      return excluded;
    }
    const ids = new Set(excluded.candidates.map(c => c.id));
    candidates = candidates.filter(c => !ids.has(c.id));
  }
  return candidates.length === 0
    ? fail('There is nothing here to do that with.')
    : { candidates, kind: 'many' };
};

const bindPhrase = (
  ctx: Context,
  words: string[],
  lastTarget: Eid | null
): PhraseResult => {
  if (ALL.includes(words[0] ?? '')) {
    return bindAll(ctx, words, lastTarget);
  }

  const and = splitOn(words, ['and']);
  if (and && both(and)) {
    const all: Candidate[] = [];
    for (const part of and) {
      const result = bindPhrase(ctx, part, lastTarget);
      if (result.kind === 'error') {
        return result;
      }
      // in a list, an ambiguous part means its first match
      all.push(
        ...(result.kind === 'ambiguous'
          ? result.candidates.slice(0, 1)
          : result.candidates)
      );
    }
    return { candidates: uniqueById(all), kind: 'many' };
  }

  const inside = splitOn(words, INSIDE);
  if (inside && both(inside)) {
    return bindInside(ctx, inside[0], inside[1], lastTarget);
  }

  if (words.length === 1 && PRONOUNS.includes(words[0]!)) {
    const it = ctx.pool.find(c => c.id === lastTarget);
    return it
      ? { candidates: [it], kind: 'many' }
      : fail(`I'm not sure what "${words.join(' ')}" refers to.`);
  }

  const found = ctx.pool.filter(c => matches(c, words));
  if (found.length === 0) {
    return fail(notFound(ctx, words.join(' ')));
  }
  // identical-looking things can't be told apart, so any one will do
  const names = new Set(found.map(c => c.name.toLowerCase()));
  return found.length > 1 && names.size > 1
    ? { candidates: found, kind: 'ambiguous' }
    : { candidates: found.slice(0, 1), kind: 'many' };
};

// `X in Y`: search inside Y instead
const bindInside = (
  ctx: Context,
  before: string[],
  after: string[],
  lastTarget: Eid | null
): PhraseResult => {
  const outer = bindPhrase(ctx, after, lastTarget);
  if (outer.kind === 'error') {
    return outer;
  }
  if (outer.kind === 'many' && outer.candidates.length !== 1) {
    return fail('You can only look in one thing.');
  }
  const box = outer.candidates[0]!;
  if (box.container === null) {
    return fail(`There is nothing in ${theName(box)}.`);
  }
  if (box.container.isClosed) {
    return fail(`${capitalise(theName(box))} is closed.`);
  }
  const result = bindPhrase(
    { ...ctx, pool: elements(ctx.store, box.id) },
    before,
    lastTarget
  );
  return result.kind === 'error' && !ALL.includes(before[0]!)
    ? fail(`There is no ${before.join(' ')} in ${theName(box)}.`)
    : result;
};

const notFound = (ctx: Context, phrase: string) =>
  ctx.reach === 'carried'
    ? `You aren't carrying any ${phrase}.`
    : `You can't see any ${phrase} here.`;

const describeList = (candidates: Candidate[]) => {
  const names = candidates.map(theName);
  return names.length <= 2
    ? names.join(' or ')
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// -- Pending commands --------------------------------------------------------

/**
 * Reads a reply as the answer to "which do you mean?": an option's number,
 * counting from 1, or words that pick exactly one option. Returns the chosen
 * id, or `null` if the reply picks none.
 */
export const resolvePending = (
  { options }: Pending,
  reply: string
): Eid | null => {
  const trimmed = reply.trim();
  if (/^[+-]?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 1 && n <= options.length ? options[n - 1]!.id : null;
  }
  const words = reply
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w !== '' && w !== 'the');
  const picked = options.filter(o =>
    matches({ words: o.name.toLowerCase().split(/\s+/) }, words)
  );
  return picked.length === 1 ? picked[0]!.id : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A pending command read back from `player.pending`, or `null` */
export const pending = (value: unknown): Pending | null =>
  isRecord(value) &&
  isRecord(value.command) &&
  Array.isArray(value.options) &&
  value.options.length > 0 &&
  (value.slot === 'target' || value.slot === 'indirect')
    ? (value as Pending)
    : null;

// The parsed command's keys, as they are stored
const KEYS = [
  ['verb', 'verb'],
  ['raw', 'raw'],
  ['target', 'target'],
  ['indirect', 'indirect'],
  ['targetReach', 'target_reach'],
  ['indirectReach', 'indirect_reach'],
  ['direction', 'direction'],
  ['text', 'text']
] as const;

const encode = (command: ParsedCommand) => {
  const out: Record<string, string> = {};
  for (const [key, stored] of KEYS) {
    const value = command[key];
    if (value !== undefined) {
      out[stored] = value;
    }
  }
  return out;
};

// A question asked before Reach was named (#181) kept its old keys
const legacyReach = (reach: string | undefined) =>
  reach === 'inv' ? 'carried' : reach;

/** The parsed command a pending command holds */
export const pendingCommand = ({ command }: Pending): ParsedCommand => {
  const out: Record<string, string> = {};
  for (const [key, stored] of KEYS) {
    const value =
      command[stored] ||
      (key === 'targetReach'
        ? legacyReach(command.target_scope)
        : key === 'indirectReach'
          ? legacyReach(command.indirect_scope)
          : undefined);
    if (value) {
      out[key] = value;
    }
  }
  return out as unknown as ParsedCommand;
};
