/**
 * Verb definitions: the words a player can type and the forms each verb
 * accepts. The parser tries a verb's forms in order and the first match
 * picks the handler (an action id).
 *
 * A form's pattern is a space-separated list of slots and literal words:
 *
 * - `dir`  a direction word (`north`, `n`, ...)
 * - `obj`  a noun phrase, captured as `target` (the direct object)
 * - `with` / `in` / any other word: a literal preposition, matched exactly
 * - `obj2` a second noun phrase after a preposition, captured as `indirect`
 * - `text` the rest of the input, case preserved, captured as `text`
 *
 * An empty pattern matches the verb on its own.
 *
 * Noun phrases are bound to entities after parsing (see `bind.ts`), searching
 * the form's scope: `inv` (carried), `room` (not carried) or `here` (both).
 *
 * A world adds verbs of its own with a `verbs` component (see
 * world/verbs.ts); a handler with no built-in action is for Scripts.
 */
import type { Scope } from '../queries/scope';

export type VerbForm = {
  handler: string;
  /** Where to look for `obj2` (default `here`) */
  indirectScope?: Scope;
  pattern: string;
  /** Where to look for `obj` (default `here`) */
  scope?: Scope;
};

export type VerbDef = {
  forms: VerbForm[];
  /** Shown when the verb is recognised but no form matches */
  incomplete?: string;
  names: string[];
};

export const DIRECTION_ALIASES: Record<string, string> = {
  d: 'down',
  e: 'east',
  n: 'north',
  ne: 'northeast',
  nw: 'northwest',
  s: 'south',
  se: 'southeast',
  sw: 'southwest',
  u: 'up',
  w: 'west'
};

export const DIRECTIONS = [
  'north',
  'south',
  'east',
  'west',
  'northeast',
  'northwest',
  'southeast',
  'southwest',
  'up',
  'down',
  'in',
  'out'
] as const;

/** The direction that leads back the way you came */
export const OPPOSITE_DIRECTIONS: Record<string, string> = {
  down: 'up',
  east: 'west',
  in: 'out',
  north: 'south',
  northeast: 'southwest',
  northwest: 'southeast',
  out: 'in',
  south: 'north',
  southeast: 'northwest',
  southwest: 'northeast',
  up: 'down',
  west: 'east'
};

/** Words dropped from noun phrases: `get the lamp` targets `lamp` */
export const ARTICLES = ['a', 'an', 'the'];

/** Words that repeat the player's previous command */
export const AGAIN_WORDS = ['again', 'g'];

export const VERBS: VerbDef[] = [
  {
    forms: [
      { handler: 'look', pattern: '' },
      { handler: 'look', pattern: 'around' },
      { handler: 'examine', pattern: 'at obj' },
      { handler: 'examine', pattern: 'in obj' },
      { handler: 'examine', pattern: 'obj' }
    ],
    names: ['look', 'l', 'examine', 'x']
  },
  {
    forms: [
      { handler: 'move', pattern: 'dir' },
      { handler: 'move', pattern: 'to dir' }
    ],
    incomplete: 'Where do you want to go?',
    names: ['move', 'go', 'walk']
  },
  {
    forms: [
      { handler: 'take', pattern: 'up obj' },
      { handler: 'take', pattern: 'obj' }
    ],
    incomplete: 'What do you want to take?',
    names: ['take', 'get', 'pick']
  },
  {
    forms: [{ handler: 'drop', pattern: 'obj', scope: 'inv' }],
    incomplete: 'What do you want to drop?',
    names: ['drop']
  },
  {
    forms: [{ handler: 'inventory', pattern: '' }],
    names: ['inventory', 'inv', 'i']
  },
  {
    forms: [{ handler: 'open', pattern: 'obj' }],
    incomplete: 'What do you want to open?',
    names: ['open']
  },
  {
    forms: [{ handler: 'close', pattern: 'obj' }],
    incomplete: 'What do you want to close?',
    names: ['close', 'shut']
  },
  {
    forms: [
      { handler: 'lock', indirectScope: 'inv', pattern: 'obj with obj2' },
      { handler: 'lock', pattern: 'obj' }
    ],
    incomplete: 'What do you want to lock?',
    names: ['lock']
  },
  {
    forms: [
      { handler: 'unlock', indirectScope: 'inv', pattern: 'obj with obj2' },
      { handler: 'unlock', pattern: 'obj' }
    ],
    incomplete: 'What do you want to unlock?',
    names: ['unlock']
  },
  {
    forms: [
      { handler: 'sayTo', pattern: 'to obj text', scope: 'room' },
      { handler: 'say', pattern: 'text' }
    ],
    incomplete: 'What do you want to say?',
    names: ['say']
  }
];

/** The verbs a world understands, by each name they answer to */
export type Vocabulary = {
  byName: ReadonlyMap<string, VerbDef>;
  defs: readonly VerbDef[];
};

/**
 * The built-in verbs plus a world's own. A world verb that shares a name
 * with another verb adds its forms, which are tried first: a world can add
 * `look under obj` without replacing `look`.
 */
export const createVocabulary = (
  extra: readonly VerbDef[] = []
): Vocabulary => {
  const byName = new Map<string, VerbDef>();
  for (const def of [...VERBS, ...extra]) {
    for (const name of def.names) {
      const existing = byName.get(name);
      byName.set(
        name,
        existing
          ? {
              ...existing,
              forms: [...def.forms, ...existing.forms],
              incomplete: def.incomplete ?? existing.incomplete
            }
          : def
      );
    }
  }
  return { byName, defs: [...VERBS, ...extra] };
};

export const BUILT_IN_VOCABULARY = createVocabulary();

const vocabularies = new WeakMap<object, Vocabulary>();

/** Gives a world its own vocabulary (see world/verbs.ts) */
export const setVocabulary = (world: object, vocabulary: Vocabulary) => {
  vocabularies.set(world, vocabulary);
};

/** The verbs a world understands: the built-ins, unless it has its own */
export const vocabularyOf = (world: object): Vocabulary =>
  vocabularies.get(world) ?? BUILT_IN_VOCABULARY;

/**
 * Every word that starts a command, for clients to complete: each verb's
 * names, then the directions and their short forms, then `again`.
 */
export const listVerbs = (
  vocabulary: Vocabulary = BUILT_IN_VOCABULARY
): string[] => [
  ...new Set([
    ...vocabulary.defs.flatMap(verb => verb.names),
    ...DIRECTIONS,
    ...Object.keys(DIRECTION_ALIASES),
    ...AGAIN_WORDS
  ])
];
