import {
  components as muaComponents,
  startMuaWorld,
  type MuaWorld
} from 'mua-world';
import type { CreateDatabaseOptions } from 'odgn-ecs/db';
import { migrateEDL, type MigrationPlan } from 'odgn-ecs/edl';
import {
  components,
  createEntity,
  inSavepoint,
  put,
  query,
  remove,
  takeChanges,
  type ChangeSetEntry,
  type Data,
  type Eid,
  type Store
} from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { EDL_PATH, SCRIPTS_DIR, reader, type WorldFiles } from './files';
import { openMirror, type MirrorSnapshot } from './mirror';

/**
 * What a Preview World is loaded from: EDL, built as an empty World is; a
 * portable subset of a World, such as a mirror (#164), to inspect; or a
 * builder's composition to try out in their mirror (#259).
 */
export type PreviewSource =
  { edl: string } | { subset: MirrorSnapshot } | { tryIt: TryIt };

/**
 * What a builder tries out: a composition, a map of buildable component
 * names to their data, in the room of the player's mirror
 */
export type TryIt = {
  composition: Record<string, Data>;
  mirror: MirrorSnapshot;
  /**
   * A placed thing being edited (#275), by its id in the mirror: the
   * composition stands in its place, where it is, rather than beside it
   */
  replaces?: Eid;
};

/**
 * Where an entity of a Try it World came from, so its changes map back:
 * the composition; an entity the player perceives, by its id in the
 * mirror; the stand-in for the player's Character; or a placeholder for
 * something the mirror doesn't hold, such as where an exit leads.
 */
export type TryItOrigin =
  | { kind: 'composition' }
  | { eid: Eid; kind: 'perceived' }
  | { eid: Eid; kind: 'stand-in' }
  | { eid?: Eid; kind: 'outside' };

export type PreviewOptions = {
  /** Milliseconds of wall time; `performance.now` by default */
  clock?: () => number;
  /** An in-memory database: Bun's in tests, sqlite-wasm in a Worker */
  database: CreateDatabaseOptions;
  /** mua-scripts and any Scripts the EDL names, from `scripts/files.ts` */
  files: WorldFiles;
  source: PreviewSource;
  /** The room the author enters; `harbour_steps` by default */
  startingRoom?: string;
};

/** From the UI to a Preview World's Worker (`preview-worker.ts`) */
export type ToPreview =
  /** Loads a Preview World, from the main World's EDL if no source is given */
  | { source?: PreviewSource; type: 'open' }
  | { ref: number; text: string; type: 'command' }
  /** Migrates the World to edited EDL, keeping its play state (ADR 0005) */
  | { edl: string; type: 'migrate' }
  | { type: 'reset' }
  | { eid: Eid; type: 'entity' };

/** An entity, with a name to show it by */
export type PreviewEntity = { eid: Eid; label: string };

/** From a Preview World's Worker */
export type FromPreview =
  /** The reply to `open` and `reset` */
  | {
      definitions: PreviewDefinition[];
      /** The EDL it was built from, for an editor to start from */
      edl?: string;
      entities: PreviewEntity[];
      event: 'opened';
      /** In a Try it World, where each entity came from */
      origins?: [Eid, TryItOrigin][];
      runs: boolean;
    }
  /** The reply to `migrate`, with the entities after it */
  | ({
      definitions: PreviewDefinition[];
      entities: PreviewEntity[];
      event: 'migrated';
    } & PreviewMigration)
  /** The reply to a `command`, with the entities after it */
  | ({
      entities: PreviewEntity[];
      event: 'result';
      ref: number;
    } & PreviewResult)
  /** The reply to `entity`: every component it has, by name */
  | { components: Record<string, Data>; eid: Eid; event: 'entity' }
  | { event: 'error'; message: string };

/** What one command did */
export type PreviewResult = {
  /** Each Step's change set, in the order they committed */
  changes: ChangeSetEntry[];
  /** What the author was told */
  lines: string[];
  ok: boolean;
  /**
   * In a Try it World, the placeholders for what the mirror doesn't hold
   * that the command changed or put something in, such as the room beyond
   * an exit. What happens there in the real World may differ.
   */
  outside?: PreviewEntity[];
  reason?: string;
};

/** What a Migration did: its plan, and the components it changed */
export type PreviewMigration =
  | { changes: ChangeSetEntry[]; ok: true; plan: MigrationPlan }
  | { ok: false; reason: string };

/** A Component Definition, as the inspector and the composer draw its cards */
export type PreviewDefinition = {
  /** A builder may compose a new entity from it (#259) */
  buildable: boolean;
  columns: { default?: unknown; name: string; type: string }[];
  name: string;
};

/** The name the author plays a Preview World under */
const AUTHOR = 'Author';

// One loaded World, before a reset throws it away
const load = async (options: PreviewOptions) => {
  const { source } = options;
  if ('subset' in source) {
    // inspect only: it holds just the subset, which has no Scripts to run
    const mirror = await openMirror(options.database);
    mirror.load(source.subset);
    return {
      author: undefined,
      command: undefined,
      edl: undefined,
      labels: new Map<Eid, string>(),
      migrate: undefined,
      origins: undefined,
      store: mirror.store
    };
  }

  const readFile = reader(options.files);
  const read = {
    path: EDL_PATH,
    readFile,
    roots: { 'mua-scripts': SCRIPTS_DIR }
  };
  const world = await createWorld(muaComponents, options.database);
  world.executeEDL('tryIt' in source ? TRY_IT_EDL : source.edl, read);
  world.flush();
  // a Try it World holds its builder's copies before its Scripts start, so
  // each has a Handle
  const tried =
    'tryIt' in source
      ? seedTryIt(
          world.store,
          world.getDefinitionNames().get(TRY_IT_ROOM)!,
          source.tryIt
        )
      : undefined;
  let edl = 'tryIt' in source ? undefined : source.edl;

  const labels = new Map<Eid, string>();
  const relabel = () => {
    labels.clear();
    for (const [name, eid] of world.getDefinitionNames()) {
      labels.set(eid, name);
    }
  };
  relabel();

  let collect: ChangeSetEntry[] | undefined;
  const start = () =>
    startMuaWorld(world, {
      clock: options.clock,
      onChanges: changes => collect?.push(...changes),
      readFile,
      scriptsDir: SCRIPTS_DIR,
      startingRoom: tried
        ? TRY_IT_ROOM
        : (options.startingRoom ?? 'harbour_steps')
    });
  let mua: MuaWorld = await start();
  let account: Eid;
  let author: Eid;
  if (tried) {
    ({ account, standIn: author } = tried);
  } else {
    account = await mua.createAccount();
    author = await mua.createCharacter(account, AUTHOR);
    await mua.enter(account, author);
  }

  const command = async (text: string): Promise<PreviewResult> => {
    const changes: ChangeSetEntry[] = [];
    collect = changes;
    try {
      const lines = await mua.command(account, author, text);
      return tried
        ? {
            changes,
            lines,
            ok: true,
            outside: reached(mua.store, tried.outside, changes)
          }
        : { changes, lines, ok: true };
    } catch (error) {
      const reason =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : String(error);
      return { changes, lines: [], ok: false, reason };
    } finally {
      collect = undefined;
    }
  };

  // A Migration of the running World, then its Scripts started again over
  // what the Migration made, as a restarted server would
  const migrate = async (next: string): Promise<PreviewMigration> => {
    if (tried) {
      return { ok: false, reason: 'try_it' };
    }
    const store = mua.store;
    // anything outside a Step so far isn't the Migration's
    takeChanges(store);
    let plan: MigrationPlan;
    try {
      // all or nothing: a Migration that fails leaves the World as it was
      plan = inSavepoint(store, 'preview_migrate', () => {
        const done = migrateEDL(world, next, read);
        world.flush();
        return done;
      });
    } catch (error) {
      takeChanges(store);
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
    const changes = takeChanges(store);
    edl = next;
    relabel();
    mua = await start();
    return { changes, ok: true, plan };
  };

  return {
    author,
    command,
    get edl() {
      return edl;
    },
    labels,
    migrate,
    origins: tried?.origins,
    store: mua.store
  };
};

// -- Try it ---------------------------------------------------------------------

/** The room a Try it World starts in, which takes on the player's room */
const TRY_IT_ROOM = 'try_it_room';

/**
 * The bundled base EDL, with its Verbs, messages and atoms, and a room for
 * the player's room to be copied onto. mua's Service Scripts and Libraries
 * load from mua-scripts as in every World.
 */
const TRY_IT_EDL = `include "mua-scripts:edl/base.edl"

entity ${TRY_IT_ROOM} {
  described { name: "Here" }
  container { capacity: 10000 is_closed: false }
}
`;

/**
 * Copies a builder's mirror into a World built from the base EDL, with
 * fresh ids and its References remapped, and adds their composition in the
 * player's room. The player's room becomes `room`, and their Character a
 * stand-in, carrying copies of what they carry. What the mirror names but
 * doesn't hold, such as where an exit leads, becomes a placeholder.
 */
const seedTryIt = (
  store: Store,
  room: Eid,
  { composition, mirror, replaces }: TryIt
) => {
  if (mirror.place === null) {
    throw new Error(
      'The Character is nowhere, so there is no room to try it in'
    );
  }
  for (const [name, data] of Object.entries(composition)) {
    if (!store.components.get(name)?.buildable) {
      throw new Error(`A builder can't compose with ${name}`);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error(`The ${name} must be a map of its properties`);
    }
  }

  const origins = new Map<Eid, TryItOrigin>();
  const outside = new Set<Eid>();
  const ids = new Map<Eid, Eid>();
  const make = (origin: TryItOrigin) => {
    const eid = createEntity(store);
    origins.set(eid, origin);
    return eid;
  };
  const placeholder = (name: string, eid?: Eid) => {
    const made = make(
      eid === undefined ? { kind: 'outside' } : { eid, kind: 'outside' }
    );
    put(store, made, 'described', { name });
    outside.add(made);
    return made;
  };

  ids.set(mirror.place, room);
  origins.set(room, { eid: mirror.place, kind: 'perceived' });
  const account = createEntity(store);
  put(store, account, 'account', {});
  const standIn = make({ eid: mirror.character, kind: 'stand-in' });
  ids.set(mirror.character, standIn);
  for (const rows of Object.values(mirror.components)) {
    for (const { eid } of rows) {
      if (!ids.has(eid)) {
        ids.set(eid, make({ eid, kind: 'perceived' }));
      }
    }
  }

  // an entity the mirror names but doesn't hold
  const remap = (eid: Eid) => {
    let id = ids.get(eid);
    if (id === undefined) {
      id = placeholder(`Something you can't perceive (#${eid})`, eid);
      ids.set(eid, id);
    }
    return id;
  };

  for (const [name, rows] of Object.entries(mirror.components)) {
    const c = store.components.get(name);
    if (!c) {
      continue;
    }
    const refs = c.columns
      .filter(col => col.type === 'eid')
      .map(col => col.name);
    for (const { eid, ...row } of rows) {
      // the stand-in is a Character of its own Account
      if (name === 'player' && eid === mirror.character) {
        continue;
      }
      const data: Data = { ...row };
      for (const ref of refs) {
        if (typeof data[ref] === 'number') {
          data[ref] = remap(data[ref]);
        }
      }
      // the mirror never says where an exit leads
      if (name === 'portal' && data.to == null) {
        data.to = placeholder(`Beyond the ${String(data.dir ?? 'exit')}`);
      }
      put(store, ids.get(eid)!, name, data);
    }
  }

  const player = mirror.components.player?.find(
    r => r.eid === mirror.character
  );
  const name = typeof player?.name === 'string' ? player.name : AUTHOR;
  put(store, standIn, 'player', { account, name });
  put(store, standIn, 'meta', { props: { id: name.toLowerCase() } });
  put(store, standIn, 'location', { in: room });

  // an edited thing takes the place of its copy, carried or not, so there
  // aren't two of it; one the mirror no longer holds is made anew
  const copy = replaces === undefined ? undefined : ids.get(replaces);
  const thing = copy ?? make({ kind: 'composition' });
  if (copy !== undefined) {
    origins.set(copy, { kind: 'composition' });
    for (const [name, c] of store.components) {
      if (c.buildable && !(name in composition)) {
        remove(store, copy, name);
      }
    }
  }
  for (const [component, data] of Object.entries(composition)) {
    put(store, thing, component, data);
  }
  if (copy === undefined) {
    put(store, thing, 'location', { in: room });
  }

  return { account, origins, outside, standIn, thing };
};

/**
 * The placeholders a Step's changes reached: one that changed, or one a
 * Reference now names, such as the room beyond an exit the stand-in took
 */
const reached = (
  store: Store,
  outside: ReadonlySet<Eid>,
  changes: ChangeSetEntry[]
): PreviewEntity[] => {
  const found = new Set<Eid>();
  for (const [eid, name, , data] of changes) {
    if (outside.has(eid)) {
      found.add(eid);
    }
    const c = store.components.get(name);
    for (const col of c?.columns ?? []) {
      const value = data?.[col.name];
      if (
        col.type === 'eid' &&
        typeof value === 'number' &&
        outside.has(value)
      ) {
        found.add(value);
      }
    }
  }
  return [...found].map(eid => ({
    eid,
    label: String(components(store, eid).described?.name ?? `#${eid}`)
  }));
};

/**
 * A Preview World (#243): a private, disposable World for authors. One built
 * from EDL runs mua's Service Scripts and Base Verbs, so it behaves as the
 * game does, and its author can run commands and see each Step's changes.
 * One loaded from a subset of a World holds only that subset, to inspect.
 * A Try it World (#259) is built from the base EDL, then a builder's mirror
 * and their composition are added: it runs, as one from EDL does, but what
 * the mirror doesn't hold is a placeholder, and a command that reaches one
 * says so.
 * `reset` puts it back to what it was loaded from. It is never saved.
 */
export const openPreviewWorld = async (options: PreviewOptions) => {
  let current = await load(options);

  const close = () => current.store.db.close();

  // A Definition name, or what the entity is called in the game
  const label = (eid: Eid) => {
    const named = current.labels.get(eid);
    if (named) {
      return named;
    }
    const c = components(current.store, eid);
    const name = (c.described?.name ?? c.player?.name) as string | undefined;
    return name ?? `#${eid}`;
  };

  return {
    /** The author's Character, in a Preview World built from EDL */
    get author(): Eid | undefined {
      return current.author;
    },

    close,

    /** Runs a command as the author, as the game would */
    command: (text: string): Promise<PreviewResult> =>
      current.command
        ? current.command(text)
        : Promise.resolve({
            changes: [],
            lines: [],
            ok: false,
            reason: 'inspect_only'
          }),

    /** The Component Definitions, for the inspector's cards */
    definitions: (): PreviewDefinition[] =>
      [...current.store.components.values()]
        .map(c => ({
          buildable: c.buildable,
          columns: c.columns.map(col => ({
            default: col.default,
            name: col.name,
            type: col.type
          })),
          name: c.name
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),

    /** Every entity, with a name to show it by */
    entities: (): PreviewEntity[] =>
      query(current.store, {}).map(eid => ({ eid, label: label(eid) })),

    /** Every component an entity has, by name */
    entity: (eid: Eid): Record<string, Data> => components(current.store, eid),

    /** Throws this World away and loads it again from its source */
    reset: async () => {
      close();
      current = await load(options);
    },

    /** The EDL it was last built or migrated from, if it came from EDL */
    get edl(): string | undefined {
      return current.edl;
    },

    /**
     * Migrates it to edited EDL, keeping its play state as a server's
     * World would (ADR 0005), and reports the plan and what changed. A
     * subset can't be migrated.
     */
    migrate: (edl: string): Promise<PreviewMigration> =>
      current.migrate
        ? current.migrate(edl)
        : Promise.resolve({ ok: false, reason: 'inspect_only' }),

    /** In a Try it World, where each entity came from */
    origins: (): [Eid, TryItOrigin][] | undefined =>
      current.origins && [...current.origins],

    /** Whether it can run commands, or only be inspected */
    runs: () => current.command !== undefined,

    get store(): Store {
      return current.store;
    }
  };
};

export type PreviewWorld = Awaited<ReturnType<typeof openPreviewWorld>>;
