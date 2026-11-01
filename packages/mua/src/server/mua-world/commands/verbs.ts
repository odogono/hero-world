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
 */
export type VerbForm = {
  handler: string;
  pattern: string;
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
];

/** Words dropped from noun phrases: `get the lamp` targets `lamp` */
export const ARTICLES = ['a', 'an', 'the'];

/** Words that repeat the player's previous command */
export const AGAIN_WORDS = ['again', 'g'];

export const VERBS: VerbDef[] = [
  {
    forms: [
      { handler: 'look', pattern: '' },
      { handler: 'look', pattern: 'at obj' },
      { handler: 'look', pattern: 'obj' }
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
    forms: [{ handler: 'say', pattern: 'text' }],
    incomplete: 'What do you want to say?',
    names: ['say']
  }
];
