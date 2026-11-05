import { get, type Data, type Eid, type Store } from 'odgn-ecs/store';

import {
  bind,
  matches,
  pendingCommand,
  pending as readPending,
  resolvePending,
  type BindResult,
  type BoundCommand,
  type Slot
} from './commands/bind';
import { parse, type ParseResult } from './commands/parser';
import { inReach } from './commands/scope';
import { AGAIN_WORDS, type Vocabulary } from './commands/verbs';

/**
 * Reads a Character's input into the commands it asks for, as
 * `MuaWorld.Input` does:
 *
 * - a reply to "which do you mean?" finishes the command waiting in
 *   `player.pending`; anything else is a new command;
 * - `again` (`g`) repeats `player.last_input`;
 * - `bob hello` means `say to bob hello` when bob is here;
 * - `it` refers to `player.last_target_id`, the last single object acted on.
 */

export type InputResult =
  | { commands: BoundCommand[]; kind: 'commands' }
  | { kind: 'reply'; message: string };

/**
 * The fields of the Character's `player` component to update, by their
 * stored names, which the caller writes
 */
export type PlayerChanges = Record<string, unknown>;

type Parsed =
  | BindResult
  | { changes: PlayerChanges; commands: BoundCommand[]; kind: 'bound+' }
  | { changes: PlayerChanges; kind: 'reply'; message: string };

export const read = (
  store: Store,
  vocabulary: Vocabulary,
  actor: Eid,
  text: string
): [InputResult, PlayerChanges] => {
  const player: Data = get(store, actor, 'player') ?? {};
  const lastTarget = (player.last_target_id as Eid | null | undefined) ?? null;
  const changes: PlayerChanges =
    player.pending == null ? {} : { pending: null };

  let result: Parsed | null = null;
  const waiting = readPending(player.pending);
  const chosen = waiting ? resolvePending(waiting, text) : null;
  if (waiting && chosen !== null) {
    const resolved: Partial<Record<Slot, Eid>> = {
      ...waiting.resolved,
      [waiting.slot]: chosen
    };
    result = bind(store, actor, pendingCommand(waiting), lastTarget, resolved);
  }
  result ??= parseLine(store, vocabulary, actor, text, player);

  switch (result.kind) {
    case 'reply':
      return [
        { kind: 'reply', message: result.message },
        { ...changes, ...result.changes }
      ];
    case 'bound+':
      return finish(
        { commands: result.commands, kind: 'bound' },
        { ...changes, ...result.changes }
      );
    default:
      return finish(result, changes);
  }
};

const finish = (
  result: BindResult,
  changes: PlayerChanges
): [InputResult, PlayerChanges] => {
  switch (result.kind) {
    case 'error':
      return [{ kind: 'reply', message: result.message }, changes];
    case 'ambiguous':
      return [
        { kind: 'reply', message: result.message },
        { ...changes, pending: result.pending }
      ];
    case 'bound': {
      const [only, ...others] = result.commands;
      const target =
        only && others.length === 0 && only.targetId !== null
          ? { last_target_id: only.targetId }
          : {};
      return [
        { commands: result.commands, kind: 'commands' },
        { ...changes, ...target }
      ];
    }
  }
};

const parseLine = (
  store: Store,
  vocabulary: Vocabulary,
  actor: Eid,
  text: string,
  player: Data
): Parsed => {
  const again = AGAIN_WORDS.includes(text.trim().toLowerCase());
  const input = again ? (player.last_input as string | null | undefined) : text;
  if (input == null) {
    return {
      changes: {},
      kind: 'reply',
      message: 'There is nothing to repeat.'
    };
  }
  const parsed = parseOrSayTo(store, vocabulary, actor, input);
  if (!parsed.ok) {
    return { changes: {}, kind: 'reply', message: parsed.message };
  }
  const lastTarget = (player.last_target_id as Eid | null | undefined) ?? null;
  const bound = bind(store, actor, parsed.command, lastTarget);
  switch (bound.kind) {
    case 'bound':
      return {
        changes: { last_input: input },
        commands: bound.commands,
        kind: 'bound+'
      };
    case 'error':
      return {
        changes: { last_input: input },
        kind: 'reply',
        message: bound.message
      };
    case 'ambiguous':
      return {
        changes: { last_input: input, pending: bound.pending },
        kind: 'reply',
        message: bound.message
      };
  }
};

// `bob hello` means "say to bob hello"
const parseOrSayTo = (
  store: Store,
  vocabulary: Vocabulary,
  actor: Eid,
  input: string
): ParseResult => {
  const parsed = parse(input, vocabulary);
  if (parsed.ok) {
    return parsed;
  }
  const first = input.trim().toLowerCase().split(/\s+/)[0];
  const listener =
    !!first &&
    inReach(store, actor, 'room').some(c => c.isPlayer && matches(c, [first]));
  return listener ? parse(`say to ${input.trim()}`, vocabulary) : parsed;
};

/**
 * Reads an NPC's command: an NPC has no one to ask "which do you mean?", so
 * an ambiguous object means its first match, and a command it can't
 * understand is dropped (`null`).
 */
export const readNpc = (
  store: Store,
  vocabulary: Vocabulary,
  actor: Eid,
  text: string
): BoundCommand[] | null => {
  const parsed = parse(text, vocabulary);
  if (!parsed.ok) {
    return null;
  }
  let resolved: Partial<Record<Slot, Eid>> = {};
  for (;;) {
    const result = bind(store, actor, parsed.command, null, resolved);
    if (result.kind === 'bound') {
      return result.commands;
    }
    const first = result.kind === 'ambiguous' && result.pending.options[0];
    if (!first) {
      return null;
    }
    resolved = { ...resolved, [result.pending.slot]: first.id };
  }
};
