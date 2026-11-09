import {
  components as muaComponents,
  startMuaWorld,
  type MuaWorld
} from 'mua-world';
import type { CreateDatabaseOptions } from 'odgn-ecs/db';
import {
  components,
  query,
  type ChangeSetEntry,
  type Data,
  type Eid,
  type Store
} from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { EDL_PATH, SCRIPTS_DIR, reader, type WorldFiles } from './files';
import { openMirror, type MirrorSnapshot } from './mirror';

/**
 * What a Preview World is loaded from: EDL, built as an empty World is, or
 * a portable subset of a World, such as a mirror (#164).
 */
export type PreviewSource = { edl: string } | { subset: MirrorSnapshot };

export type PreviewOptions = {
  /** Milliseconds of wall time; `performance.now` by default */
  clock?: () => number;
  /** An in-memory database: Bun's in tests, sqlite-wasm in a Worker */
  database: CreateDatabaseOptions;
  /** mua-scripts and any Scripts the EDL names, from `scripts/files.ts` */
  files: WorldFiles;
  source: PreviewSource;
  /** The room the author enters; `west_of_house` by default */
  startingRoom?: string;
};

/** From the UI to a Preview World's Worker (`preview-worker.ts`) */
export type ToPreview =
  /** Loads a Preview World, from the main World's EDL if no source is given */
  | { source?: PreviewSource; type: 'open' }
  | { ref: number; text: string; type: 'command' }
  | { type: 'reset' }
  | { eid: Eid; type: 'entity' };

/** An entity, with a name to show it by */
export type PreviewEntity = { eid: Eid; label: string };

/** From a Preview World's Worker */
export type FromPreview =
  /** The reply to `open` and `reset` */
  | {
      definitions: PreviewDefinition[];
      entities: PreviewEntity[];
      event: 'opened';
      runs: boolean;
    }
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
  reason?: string;
};

/** A Component Definition, as the inspector draws its cards */
export type PreviewDefinition = {
  columns: { name: string; type: string }[];
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
      labels: new Map<Eid, string>(),
      store: mirror.store
    };
  }

  const readFile = reader(options.files);
  const world = await createWorld(muaComponents, options.database);
  world.executeEDL(source.edl, {
    path: EDL_PATH,
    readFile,
    roots: { 'mua-scripts': SCRIPTS_DIR }
  });
  world.flush();
  const labels = new Map<Eid, string>();
  for (const [name, eid] of world.getDefinitionNames()) {
    labels.set(eid, name);
  }

  let collect: ChangeSetEntry[] | undefined;
  const mua: MuaWorld = await startMuaWorld(world, {
    clock: options.clock,
    onChanges: changes => collect?.push(...changes),
    readFile,
    scriptsDir: SCRIPTS_DIR,
    startingRoom: options.startingRoom ?? 'west_of_house'
  });
  const account = await mua.createAccount();
  const author = await mua.createCharacter(account, AUTHOR);
  await mua.enter(account, author);

  const command = async (text: string): Promise<PreviewResult> => {
    const changes: ChangeSetEntry[] = [];
    collect = changes;
    try {
      const lines = await mua.command(account, author, text);
      return { changes, lines, ok: true };
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

  return { author, command, labels, store: mua.store };
};

/**
 * A Preview World (#243): a private, disposable World for authors. One built
 * from EDL runs mua's Service Scripts and Base Verbs, so it behaves as the
 * game does, and its author can run commands and see each Step's changes.
 * One loaded from a subset of a World holds only that subset, to inspect.
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
          columns: c.columns.map(col => ({ name: col.name, type: col.type })),
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

    /** Whether it can run commands, or only be inspected */
    runs: () => current.command !== undefined,

    get store(): Store {
      return current.store;
    }
  };
};

export type PreviewWorld = Awaited<ReturnType<typeof openPreviewWorld>>;
