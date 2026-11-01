import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import {
  getElements,
  getInScope,
  theName,
  type Candidate,
  type Scope
} from '../queries/scope';
import type { ParsedCommand } from './types';

type MuaWorld = World<MuaComponents>;

export type Slot = 'indirect' | 'target';

/** One command bound to the objects it acts on */
export type BoundCommand = ParsedCommand & {
  indirectId?: EntityId;
  /** Set when the command was expanded over several objects */
  label?: string;
  targetId?: EntityId;
};

/** A command waiting for the player to choose between objects */
export type PendingCommand = {
  command: ParsedCommand;
  options: { id: EntityId; name: string }[];
  /** Objects already chosen for each slot */
  resolved: Partial<Record<Slot, EntityId>>;
  slot: Slot;
};

export type BindResult =
  | { commands: BoundCommand[]; kind: 'bound' }
  | { kind: 'ambiguous'; message: string; pending: PendingCommand }
  | { kind: 'error'; message: string };

type PhraseResult =
  | { candidates: Candidate[]; kind: 'many' }
  | { candidates: Candidate[]; kind: 'ambiguous' }
  | { kind: 'error'; message: string };

const ALL_WORDS = new Set(['all', 'everything']);
const EXCEPT_WORDS = new Set(['but', 'except']);
const INSIDE_WORDS = new Set(['from', 'in', 'inside']);
const PRONOUNS = new Set(['it', 'that']);

const splitOn = (words: string[], separators: Set<string>) => {
  const index = words.findIndex(w => separators.has(w));
  return index < 0
    ? undefined
    : { after: words.slice(index + 1), before: words.slice(0, index) };
};

/**
 * Does a candidate answer to these words? The last word is the noun and must
 * be one of its words; any words before it (adjectives) must be too.
 */
export const matchesWords = (candidate: Candidate, words: string[]) =>
  words.length > 0 && words.every(w => candidate.words.includes(w));

const describeList = (candidates: Candidate[]) => {
  const names = candidates.map(theName);
  return names.length <= 2
    ? names.join(' or ')
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
};

type BindContext = {
  actorId: EntityId;
  /** The candidates to search, already narrowed to the verb form's scope */
  pool: Candidate[];
  scope: Scope;
  world: MuaWorld;
};

const notFound = (ctx: BindContext, phrase: string) =>
  ctx.scope === 'inv'
    ? `You aren't carrying any ${phrase}.`
    : `You can't see any ${phrase} here.`;

/**
 * Resolves a noun phrase against a pool of candidates. Handles `all`,
 * `all except X`, `X and Y`, `X in Y`, `it`, and adjectives before the noun.
 */
const bindPhrase = (
  ctx: BindContext,
  words: string[],
  lastTargetId: EntityId | undefined
): PhraseResult => {
  const phrase = words.join(' ');

  // `all`, `all except X`
  if (ALL_WORDS.has(words[0]!)) {
    // `take all` means what's around you; `drop all` what you carry
    let candidates = ctx.pool.filter(
      c => !c.isPlayer && (ctx.scope === 'inv' || c.locationId !== ctx.actorId)
    );
    const except = splitOn(words, EXCEPT_WORDS);
    if (except && except.after.length > 0) {
      const excluded = bindPhrase(ctx, except.after, lastTargetId);
      if (excluded.kind === 'error') {
        return excluded;
      }
      const ids = new Set(excluded.candidates.map(c => c.id));
      candidates = candidates.filter(c => !ids.has(c.id));
    }
    return candidates.length > 0
      ? { candidates, kind: 'many' }
      : { kind: 'error', message: 'There is nothing here to do that with.' };
  }

  // `X and Y`
  const and = splitOn(words, new Set(['and']));
  if (and && and.before.length > 0 && and.after.length > 0) {
    const results = [and.before, and.after].map(part =>
      bindPhrase(ctx, part, lastTargetId)
    );
    const candidates: Candidate[] = [];
    for (const result of results) {
      if (result.kind === 'error') {
        return result;
      }
      // in a list, an ambiguous part means its first match
      candidates.push(
        ...(result.kind === 'ambiguous'
          ? result.candidates.slice(0, 1)
          : result.candidates)
      );
    }
    return { candidates: [...new Set(candidates)], kind: 'many' };
  }

  // `X in Y`: search inside Y instead
  const inside = splitOn(words, INSIDE_WORDS);
  if (inside && inside.before.length > 0 && inside.after.length > 0) {
    const holder = bindPhrase(ctx, inside.after, lastTargetId);
    if (holder.kind === 'error') {
      return holder;
    }
    if (holder.kind === 'many' && holder.candidates.length !== 1) {
      return { kind: 'error', message: 'You can only look in one thing.' };
    }
    const [box] = holder.candidates;
    if (!box?.container) {
      return {
        kind: 'error',
        message: `There is nothing in ${theName(box!)}.`
      };
    }
    if (box.container.isClosed) {
      return {
        kind: 'error',
        message: `${capitalise(theName(box))} is closed.`
      };
    }
    const pool = getElements(ctx.world, box.id);
    const result = bindPhrase({ ...ctx, pool }, inside.before, lastTargetId);
    if (result.kind === 'error' && !ALL_WORDS.has(inside.before[0]!)) {
      return {
        kind: 'error',
        message: `There is no ${inside.before.join(' ')} in ${theName(box)}.`
      };
    }
    return result;
  }

  // `it`
  if (words.length === 1 && PRONOUNS.has(words[0]!)) {
    const it = ctx.pool.find(c => c.id === lastTargetId);
    return it
      ? { candidates: [it], kind: 'many' }
      : { kind: 'error', message: `I'm not sure what "${phrase}" refers to.` };
  }

  const matches = ctx.pool.filter(c => matchesWords(c, words));
  if (matches.length === 0) {
    return { kind: 'error', message: notFound(ctx, phrase) };
  }
  // identical-looking things can't be told apart, so any one will do
  const names = new Set(matches.map(c => c.name.toLowerCase()));
  if (matches.length > 1 && names.size > 1) {
    return { candidates: matches, kind: 'ambiguous' };
  }
  return { candidates: matches.slice(0, 1), kind: 'many' };
};

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

export type BindOptions = {
  actorId: EntityId;
  command: ParsedCommand;
  /** What `it` refers to: the last single object the actor acted on */
  lastTargetId?: EntityId;
  /** Objects already chosen, e.g. by answering a "which one?" question */
  resolved?: Partial<Record<Slot, EntityId>>;
  world: MuaWorld;
};

/**
 * Binds a parsed command's noun phrases to entities in scope. A phrase that
 * names several objects (`all`, `X and Y`) expands into one command each.
 */
export const bindCommand = ({
  actorId,
  command,
  lastTargetId,
  resolved = {},
  world
}: BindOptions): BindResult => {
  const ids: Partial<Record<Slot, Candidate[]>> = {};

  for (const slot of ['target', 'indirect'] as const) {
    const phrase = command[slot];
    if (phrase === undefined) {
      continue;
    }
    const scope =
      (slot === 'target' ? command.targetScope : command.indirectScope) ??
      'here';
    const pool = getInScope(world, actorId, scope);
    const chosen = resolved[slot];
    if (chosen !== undefined) {
      const candidate = pool.find(c => c.id === chosen);
      if (!candidate) {
        return { kind: 'error', message: 'That is no longer here.' };
      }
      ids[slot] = [candidate];
      continue;
    }

    const result = bindPhrase(
      { actorId, pool, scope, world },
      phrase.split(/\s+/),
      lastTargetId
    );
    if (result.kind === 'error') {
      return result;
    }
    if (result.kind === 'ambiguous') {
      return {
        kind: 'ambiguous',
        message: `Which do you mean: ${describeList(result.candidates)}?`,
        pending: {
          command,
          options: result.candidates.map(c => ({ id: c.id, name: c.name })),
          resolved,
          slot
        }
      };
    }
    ids[slot] = result.candidates;
  }

  const targets = ids.target ?? [undefined];
  const indirect = ids.indirect?.[0];
  const isMany = targets.length > 1;

  return {
    commands: targets.map(target => ({
      ...command,
      indirectId: indirect?.id,
      label: isMany && target ? target.name : undefined,
      targetId: target?.id
    })),
    kind: 'bound'
  };
};

/**
 * Tries to read a reply as the answer to a "which do you mean?" question.
 * Returns the chosen id, or undefined if the reply doesn't pick exactly one.
 */
export const resolvePending = (pending: PendingCommand, reply: string) => {
  const words = reply
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w && w !== 'the');
  const matches = pending.options.filter(option =>
    matchesWords(
      {
        id: option.id,
        isPlayer: false,
        isTakeable: false,
        locationId: 0,
        name: option.name,
        words: option.name.toLowerCase().split(/\s+/)
      },
      words
    )
  );
  return matches.length === 1 ? matches[0]!.id : undefined;
};

export const isPendingCommand = (value: unknown): value is PendingCommand =>
  typeof value === 'object' &&
  value !== null &&
  'command' in value &&
  'options' in value &&
  'slot' in value;
