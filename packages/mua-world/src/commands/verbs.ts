import { get, query, type Data, type Eid, type Store } from 'odgn-ecs/store';

/**
 * A World's vocabulary, as `MuaWorld.Commands.Verbs` reads it: its Verbs,
 * with the forms each can be typed in, and its Directions, Aliases and
 * articles. All of it is World data (ADR 0024): the Base Verbs come from
 * `mua-scripts/edl/base.edl`, which a World's EDL includes, and a World adds
 * its own with more `verbs` and `words` components. The parser tries a
 * verb's forms in order, and the first match picks the handler.
 *
 * A form's pattern is a space-separated list of slots and literal words:
 * `dir` (a Direction word), `obj` (a noun phrase, the target), `obj2` (a
 * second noun phrase after a preposition, the indirect), `text` (the rest of
 * the input, case preserved), or a literal word matched exactly. An empty
 * pattern matches the verb on its own.
 */

export type Reach = 'carried' | 'here' | 'room';

export type Form = {
  handler: string;
  indirectReach: Reach | null;
  pattern: string;
  reach: Reach | null;
};

export type Veto = { about: string; asks: string; event: string };

export type Verb = {
  forms: Form[];
  incomplete: string | null;
  names: string[];
  vetoes: Veto[];
};

export type Vocabulary = {
  aliases: Map<string, string>;
  articles: string[];
  byName: Map<string, Verb>;
  defs: Verb[];
  /** Each Direction with its opposite, in the order a World declares them */
  directions: [string, string | null][];
  /** Each handler's Vetoes */
  vetoes: Map<string, Veto[]>;
};

const REACHES: readonly (Reach | null | undefined)[] = [
  undefined,
  null,
  'here',
  'carried',
  'room'
];

/** The words that repeat the last command. The Host reads these itself. */
export const AGAIN_WORDS = ['again', 'g'];

/** A Direction word, or an Alias of one, as a Direction; `null` otherwise */
export const toDirection = (
  vocabulary: Vocabulary,
  word: string | undefined
): string | null => {
  if (word === undefined) {
    return null;
  }
  const direction = vocabulary.aliases.get(word) ?? word;
  return vocabulary.directions.some(([name]) => name === direction)
    ? direction
    : null;
};

/** The Directions, in the order a World declares them */
export const directions = (vocabulary: Vocabulary) =>
  vocabulary.directions.map(([name]) => name);

/** A Direction's opposite, or `null` */
export const opposite = (vocabulary: Vocabulary, direction: string) =>
  vocabulary.directions.find(([name]) => name === direction)?.[1] ?? null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [list])
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.toLowerCase());

const toForm = (form: unknown): Form | null => {
  if (
    !isRecord(form) ||
    typeof form.handler !== 'string' ||
    typeof form.pattern !== 'string'
  ) {
    return null;
  }
  const reach = form.reach as Reach | null | undefined;
  const indirect = form.indirect_reach as Reach | null | undefined;
  return REACHES.includes(reach) && REACHES.includes(indirect)
    ? {
        handler: form.handler,
        indirectReach: indirect ?? null,
        pattern: form.pattern,
        reach: reach ?? null
      }
    : null;
};

const toVeto = (veto: unknown): Veto | null =>
  isRecord(veto) &&
  typeof veto.event === 'string' &&
  typeof veto.asks === 'string' &&
  typeof veto.about === 'string'
    ? { about: veto.about, asks: veto.asks, event: veto.event }
    : null;

const list = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const toVerb = (def: unknown): Verb | null => {
  if (!isRecord(def)) {
    return null;
  }
  const names = strings(def.names);
  const forms = list(def.forms)
    .map(toForm)
    .filter((f): f is Form => f !== null);
  const vetoes = list(def.vetoes)
    .map(toVeto)
    .filter((v): v is Veto => v !== null);
  if (names.length === 0 || forms.length === 0) {
    return null;
  }
  const incomplete = typeof def.incomplete === 'string' ? def.incomplete : null;
  return { forms, incomplete, names, vetoes };
};

// A later Direction of the same name replaces the earlier, in its place
const directionsOf = (words: Record<string, unknown>[]) => {
  const out: [string, string | null][] = [];
  for (const w of words) {
    if (!Array.isArray(w.directions)) {
      continue;
    }
    for (const d of w.directions) {
      if (!isRecord(d) || typeof d.name !== 'string') {
        continue;
      }
      const name = d.name.toLowerCase();
      const opp =
        typeof d.opposite === 'string' ? d.opposite.toLowerCase() : null;
      const i = out.findIndex(([n]) => n === name);
      if (i === -1) {
        out.push([name, opp]);
      } else {
        out[i] = [name, opp];
      }
    }
  }
  return out;
};

const merge = (words: Record<string, unknown>[], key: string) => {
  const out = new Map<string, string>();
  for (const w of words) {
    const map = w[key];
    if (!isRecord(map)) {
      continue;
    }
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'string') {
        out.set(k.toLowerCase(), v.toLowerCase());
      }
    }
  }
  return out;
};

/**
 * A vocabulary from `verbs` and `words` components, in order. A verb that
 * shares a name with an earlier one adds its forms, which are tried first: a
 * World can add `look under obj` without replacing `look`. A malformed verb
 * is skipped.
 */
export const fromComponents = (
  components: { verbs?: Data; words?: Data }[]
): Vocabulary => {
  const defs: Verb[] = [];
  for (const c of components) {
    if (c.verbs && Array.isArray(c.verbs.defs)) {
      for (const def of c.verbs.defs) {
        const verb = toVerb(def);
        if (verb) {
          defs.push(verb);
        }
      }
    }
  }
  const words = components
    .map(c => c.words)
    .filter((w): w is Data => isRecord(w));

  const byName = new Map<string, Verb>();
  for (const def of defs) {
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

  // A later Verb declaring Vetoes for a handler replaces the earlier ones
  const vetoes = new Map<string, Veto[]>();
  for (const def of defs) {
    if (def.vetoes.length > 0) {
      for (const form of def.forms) {
        vetoes.set(form.handler, def.vetoes);
      }
    }
  }

  return {
    aliases: merge(words, 'aliases'),
    articles: [...new Set(words.flatMap(w => strings(w.articles ?? [])))],
    byName,
    defs,
    directions: directionsOf(words),
    vetoes
  };
};

/**
 * The vocabulary of a World: every entity's `verbs` and `words` components,
 * in entity order, so the Base Verbs a World includes first come first.
 */
export const fromWorld = (store: Store): Vocabulary => {
  const eids: Eid[] = [
    ...new Set([
      ...query(store, { with: ['verbs'] }),
      ...query(store, { with: ['words'] })
    ])
  ].sort((a, b) => a - b);
  return fromComponents(
    eids.map(eid => ({
      verbs: get(store, eid, 'verbs'),
      words: get(store, eid, 'words')
    }))
  );
};

/**
 * Every word that starts a command, for clients to complete: each verb's
 * names, then the Directions and their Aliases, then `again`.
 */
export const words = (vocabulary: Vocabulary) => [
  ...new Set([
    ...vocabulary.defs.flatMap(d => d.names),
    ...directions(vocabulary),
    ...[...vocabulary.aliases.keys()].sort(),
    ...AGAIN_WORDS
  ])
];
