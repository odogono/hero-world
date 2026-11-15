import { get, query, type Data, type Eid, type Store } from 'odgn-ecs/store';

/**
 * A World's vocabulary, as `MuaWorld.Commands.Verbs` reads it: its Verbs,
 * with the forms each can be typed in, and its Directions, Aliases and
 * articles. All of it is World data (ADR 0024): the Base Verbs come from
 * `mua-scripts/edl/base.edl`, which a World's EDL includes, and a World adds
 * its own with more `verbs` and `words` components. The parser tries a
 * verb's forms in order, and the first match picks the Action the Command
 * asks for.
 *
 * A form's pattern is a space-separated list of slots and literal words:
 * `dir` (a Direction word), `obj` (a noun phrase, the target), `obj2` (a
 * second noun phrase after a preposition, the indirect), `text` (the rest of
 * the input, case preserved), or a literal word matched exactly. An empty
 * pattern matches the verb on its own.
 *
 * Each Action is declared in an `actions` component (ADR 0029): the Service
 * Script that carries it out, if any, and the roles it is sent. Each
 * Service Script is declared in a `services` component, by name and `src`.
 * A later declaration of the same name replaces the earlier.
 */

export type Reach = 'carried' | 'here' | 'room';

export type Form = {
  action: string;
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

/** An Action: the Service that carries it out, if any, and the roles it is sent */
export type Action = { args: string[]; service: string | null };

export type Vocabulary = {
  actions: Map<string, Action>;
  aliases: Map<string, string>;
  articles: string[];
  byName: Map<string, Verb>;
  defs: Verb[];
  /** Each Direction with its opposite, in the order a World declares them */
  directions: [string, string | null][];
  /** Each Service Script's `src`, by name */
  services: Map<string, string>;
  /** Each Action's Vetoes */
  vetoes: Map<string, Veto[]>;
};

const ARGS = ['target', 'actor'];

/** The Services the Host asks itself, not through an Action */
const HOST_SERVICES = ['lifecycle', 'build'];

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
    typeof form.action !== 'string' ||
    typeof form.pattern !== 'string'
  ) {
    return null;
  }
  const reach = form.reach as Reach | null | undefined;
  const indirect = form.indirect_reach as Reach | null | undefined;
  return REACHES.includes(reach) && REACHES.includes(indirect)
    ? {
        action: form.action,
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

const toAction = (def: unknown): Action | null => {
  if (!isRecord(def)) {
    return null;
  }
  const { service } = def;
  const args = def.args ?? ARGS;
  return (service == null || typeof service === 'string') &&
    Array.isArray(args) &&
    args.every(a => typeof a === 'string')
    ? { args: args as string[], service: (service as string | null) ?? null }
    : null;
};

const toService = (def: unknown): string | null =>
  isRecord(def) && typeof def.src === 'string' && def.src !== ''
    ? def.src
    : null;

// Each name's declaration in the components' `defs` maps, a later one
// replacing the earlier; a malformed one is skipped
const declared = <T>(
  components: Components[],
  key: 'actions' | 'services',
  to: (def: unknown) => T | null
) => {
  const out = new Map<string, T>();
  for (const c of components) {
    const defs = c[key]?.defs;
    if (!isRecord(defs)) {
      continue;
    }
    for (const [name, def] of Object.entries(defs)) {
      const value = to(def);
      if (value !== null) {
        out.set(name, value);
      }
    }
  }
  return out;
};

type Components = {
  actions?: Data;
  services?: Data;
  verbs?: Data;
  words?: Data;
};

const COMPONENTS = ['verbs', 'words', 'actions', 'services'] as const;

/**
 * A vocabulary from `verbs`, `words`, `actions` and `services` components,
 * in order. A verb that
 * shares a name with an earlier one adds its forms, which are tried first: a
 * World can add `look under obj` without replacing `look`. A malformed verb
 * is skipped.
 */
export const fromComponents = (components: Components[]): Vocabulary => {
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

  // A later Verb declaring Vetoes for an Action replaces the earlier ones
  const vetoes = new Map<string, Veto[]>();
  for (const def of defs) {
    if (def.vetoes.length > 0) {
      for (const form of def.forms) {
        vetoes.set(form.action, def.vetoes);
      }
    }
  }

  return {
    actions: declared(components, 'actions', toAction),
    aliases: merge(words, 'aliases'),
    articles: [...new Set(words.flatMap(w => strings(w.articles ?? [])))],
    byName,
    defs,
    directions: directionsOf(words),
    services: declared(components, 'services', toService),
    vetoes
  };
};

/**
 * The vocabulary of a World: every entity's `verbs`, `words`, `actions` and
 * `services` components, in entity order, so the Base Verbs a World
 * includes first come first.
 */
export const fromWorld = (store: Store): Vocabulary => {
  const eids: Eid[] = [
    ...new Set(COMPONENTS.flatMap(c => query(store, { with: [c] })))
  ].sort((a, b) => a - b);
  return fromComponents(
    eids.map(eid =>
      Object.fromEntries(COMPONENTS.map(c => [c, get(store, eid, c)]))
    )
  );
};

/**
 * The file of a Service's `src`: under a named root when it starts with
 * `<root>:`, else relative to the World's EDL file. `null` for an unknown
 * root.
 */
export const servicePath = (
  src: string,
  roots: Record<string, string>,
  edlPath: string
): string | null => {
  const at = src.indexOf(':');
  if (at > 1) {
    const dir = roots[src.slice(0, at)];
    return dir === undefined ? null : `${dir}/${src.slice(at + 1)}`;
  }
  return joinPath(dirname(edlPath), src);
};

const dirname = (path: string) => {
  const at = path.lastIndexOf('/');
  return at === -1 ? '.' : path.slice(0, at) || '/';
};

// `dir` and `relative` joined, `.` and `..` worked out
const joinPath = (dir: string, relative: string) => {
  const parts: string[] = [];
  for (const part of `${dir}/${relative}`.split('/')) {
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') {
      parts.pop();
    } else if (part !== '.' && (part !== '' || parts.length === 0)) {
      parts.push(part);
    }
  }
  return parts.join('/');
};

// A map's entries, sorted by key
const sorted = <T>(map: Map<string, T>) =>
  [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Each declared Service Script's name and file, sorted by name */
export const serviceFiles = (
  vocabulary: Vocabulary,
  roots: Record<string, string>,
  edlPath: string
) =>
  sorted(vocabulary.services).map(
    ([name, src]) => [name, servicePath(src, roots, edlPath)] as const
  );

/**
 * What is wrong with a vocabulary's Actions and Services, as a list of
 * messages: a form asking for an undeclared Action, an Action or a Veto
 * naming an undeclared Service, a Service the Host asks itself missing, or
 * a Service's `src` under a root that isn't one of `roots`. A World with
 * any of these won't start.
 */
export const problems = (
  vocabulary: Vocabulary,
  roots: Record<string, string>
): string[] => {
  const { actions, services } = vocabulary;
  const undeclaredActions = vocabulary.defs.flatMap(def =>
    def.forms
      .filter(form => !actions.has(form.action))
      .map(
        form =>
          `${def.names[0]} asks for the Action ${form.action}, which isn't declared`
      )
  );
  const undeclaredServices = sorted(actions)
    .filter(([, a]) => a.service !== null && !services.has(a.service))
    .map(
      ([name, a]) =>
        `the Action ${name} names the Service ${a.service}, which isn't declared`
    );
  const vetoes = vocabulary.defs.flatMap(def =>
    def.vetoes
      .filter(
        v =>
          v.asks.startsWith('service:') &&
          !services.has(v.asks.slice('service:'.length))
      )
      .map(
        v =>
          `${v.event} asks the Service ${v.asks.slice('service:'.length)}, which isn't declared`
      )
  );
  const host = HOST_SERVICES.filter(s => !services.has(s)).map(
    s => `the Service ${s} isn't declared`
  );
  const srcs = sorted(services)
    .filter(([, src]) => servicePath(src, roots, '.') === null)
    .map(
      ([name, src]) =>
        `the Service ${name}'s src ${src} is under no root mua knows`
    );
  return [
    ...new Set([
      ...undeclaredActions,
      ...undeclaredServices,
      ...vetoes,
      ...host,
      ...srcs
    ])
  ];
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
