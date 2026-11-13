import {
  MuaWorldError,
  components,
  startMuaWorld,
  type MuaWorld
} from 'mua-world';
import {
  isSqliteFile,
  replaceDatabase,
  type CreateDatabaseOptions
} from 'odgn-ecs/db';
import { isEDLBuilt, isEDLChanged, migrateEDL } from 'odgn-ecs/edl';
import { get, put, type Eid } from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

import { EDL_PATH, SCRIPTS_DIR, reader, type WorldFiles } from './files';
import type { Builder, FromWorld, ToWorld } from './protocol';

/** Commands are at most this long, as on the server */
const MAX_COMMAND = 500;

export type LocalWorldOptions = {
  /** Milliseconds of wall time; `performance.now` by default */
  clock?: () => number;
  /** Where the World's database is, such as OPFS in a Worker */
  database: CreateDatabaseOptions;
  /** The World's files, from `scripts/files.ts` */
  files: WorldFiles;
  /**
   * Refuse a database that isn't a built World, as when loading a save,
   * rather than build one into it
   */
  requireBuilt?: boolean;
  /** Called with each message for the UI */
  send: (message: FromWorld) => void;
  /** The room Characters enter first; `west_of_house` by default */
  startingRoom?: string;
};

// The one Account a Local World has, and its Character, kept in the World
// so a reload plays the same Character
const LOCAL_SCHEMA =
  'CREATE TABLE IF NOT EXISTS mua_local (key TEXT PRIMARY KEY, value INTEGER NOT NULL)';

type Ref = number | string;

// A message's `ref`, as the Channel takes it: text, a number or none
const isRef = (ref: unknown): ref is Ref | undefined =>
  ref === undefined || typeof ref === 'string' || typeof ref === 'number';

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The World's reason for refusing; anything else is the Worker's to report
const fail = (error: unknown) => {
  if (error instanceof MuaWorldError) {
    return error.code;
  }
  throw error;
};

/**
 * A Local World (ADR 0023): one mua World and the single Character played
 * in it, speaking the Channel's messages. It has a local Account, with no
 * sign-in or Allowlist, and never syncs with a server. Its database is its
 * save. A World built from an older EDL is migrated before it plays.
 *
 * The local Account builds, with the default limits (#292): there is no
 * Admin prompt offline to make it a Builder.
 */
export const openLocalWorld = async (options: LocalWorldOptions) => {
  const { files, send } = options;
  const readFile = reader(files);
  const edl = readFile(EDL_PATH);
  const read = {
    path: EDL_PATH,
    readFile,
    roots: { 'mua-scripts': SCRIPTS_DIR }
  };

  const world = await createWorld(components, options.database);
  if (options.requireBuilt && !isEDLBuilt(world)) {
    world.store.db.close();
    throw new Error('That file is not a saved World');
  }
  if (!isEDLBuilt(world)) {
    world.executeEDL(edl, read);
  } else if (isEDLChanged(world, edl, read)) {
    migrateEDL(world, edl, read);
  }
  world.flush();

  const mua: MuaWorld = await startMuaWorld(world, {
    clock: options.clock,
    readFile,
    scriptsDir: SCRIPTS_DIR,
    startingRoom: options.startingRoom ?? 'west_of_house'
  });
  const { store } = mua;
  store.db.exec(LOCAL_SCHEMA);
  const stored = (key: string) =>
    (
      store.db.query('SELECT value FROM mua_local WHERE key = ?1', [key]) as {
        value: number;
      }[]
    )[0]?.value;
  const keep = (key: string, value: number) =>
    store.db.exec(
      'INSERT OR REPLACE INTO mua_local (key, value) VALUES (?1, ?2)',
      [key, value]
    );

  let account: Eid | undefined = stored('account');
  let character: Eid | undefined = stored('character');
  let unsubscribe: (() => void) | undefined;
  // The placed thing the client has open in its Composer, as the Channel
  // tracks it, and whether a Step has changed it since it was last checked
  let composing: Eid | undefined;
  let editingChanged = false;

  // The thing the `edit` Verb opened, once each time it changes, so the
  // client opens it in the Composer; `closed` when it closes in the World
  // without the client asking (#274, #284)
  const compose = async () => {
    editingChanged = false;
    if (account === undefined || character === undefined) {
      return;
    }
    let opened;
    try {
      opened = await mua.editing(account, character);
    } catch (error) {
      fail(error);
      return;
    }
    if (opened) {
      if (composing !== opened.eid) {
        send({ event: 'compose', ...opened });
      }
      composing = opened.eid;
    } else {
      if (composing !== undefined) {
        send({ eid: composing, event: 'closed' });
      }
      composing = undefined;
    }
  };

  // What the Character sees, and any "Which do you mean?", after each command
  const refresh = async () => {
    if (account === undefined || character === undefined) {
      return;
    }
    try {
      const state = await mua.view(account, character);
      if (state) {
        send({ event: 'state', state });
      }
    } catch (error) {
      if (!(error instanceof MuaWorldError)) {
        throw error;
      }
    }
    const pending = get(store, character, 'player')?.pending as
      { options?: { name: string }[] } | null | undefined;
    if (pending?.options && pending.options.length > 0) {
      send({
        event: 'prompt',
        options: pending.options.map(o => o.name),
        text: 'Which do you mean?'
      });
    }
    await compose();
  };

  // The Account's building limits and count, as the Channel's join replies
  const builderOf = async (of: Eid): Promise<Builder | null> => {
    const b = await mua.builder(of);
    return b
      ? {
          max_capacity: b.maxCapacity,
          max_placed: b.maxPlaced,
          placed: b.placed
        }
      : null;
  };

  const join = async (name: string) => {
    if (account === undefined) {
      account = await mua.createAccount();
      keep('account', account);
    }
    // made with the Account, or on the next join of a World saved before
    // a Local World could build; `{}` takes the default limits
    if (!get(store, account, 'builder')) {
      put(store, account, 'builder', {});
    }
    if (character === undefined) {
      character = await mua.createCharacter(account, name);
      keep('character', character);
    }
    const lines = await mua.enter(account, character);
    send({ builder: await builderOf(account), character, event: 'joined' });
    send({ event: 'status', status: 'connected' });
    if (lines.length > 0) {
      send({ event: 'output', lines });
    }
    // subscribed after the entry's own lines, so none arrives twice
    unsubscribe?.();
    unsubscribe = await mua.subscribe(
      character,
      (line, suggestions) =>
        send(
          suggestions
            ? { event: 'output', lines: [line], suggestions }
            : { event: 'output', lines: [line] }
        ),
      {
        onEditing: () => {
          editingChanged = true;
        }
      }
    );
    // a rejoin opens what the Character has open again, as the Channel does
    composing = undefined;
    await refresh();
  };

  const command = async (ref: number | string, text: string) => {
    if (account === undefined || character === undefined) {
      send({ event: 'reply', ok: false, reason: 'not_joined', ref });
      return;
    }
    if (text.length > MAX_COMMAND) {
      send({ event: 'reply', ok: false, reason: 'too_long', ref });
      return;
    }
    try {
      await mua.command(account, character, text);
      send({ event: 'reply', ok: true, ref });
    } catch (error) {
      const reason = error instanceof MuaWorldError ? error.code : 'failed';
      send({ event: 'reply', ok: false, reason, ref });
    }
    await refresh();
  };

  // Runs one of the Channel's building messages for the local Character,
  // replying with `done`'s payload or the World's reason for refusing
  const building = async (
    ref: unknown,
    run: (account: Eid, character: Eid) => Promise<Record<string, unknown>>
  ) => {
    if (!isRef(ref)) {
      send({
        event: 'reply',
        ok: false,
        reason: 'ref must be text or a number'
      });
      return;
    }
    if (account === undefined || character === undefined) {
      send({ event: 'reply', ok: false, reason: 'not_joined', ref });
      return;
    }
    try {
      const done = await run(account, character);
      send({ event: 'reply', ok: true, ref, ...done } as FromWorld);
    } catch (error) {
      send({ event: 'reply', ok: false, reason: fail(error), ref });
    }
    await refresh();
  };

  // A builder's composed thing, placed in the Character's room (#258)
  const place = (ref: unknown, composition: unknown) => {
    if (!isMap(composition)) {
      send({
        event: 'reply',
        ok: false,
        reason: 'a place needs a composition'
      });
      return;
    }
    return building(ref, async (a, c) => {
      const { eid, maxPlaced, placed } = await mua.place(a, c, composition);
      return { eid, max_placed: maxPlaced, placed };
    });
  };

  // Saving an edit to the placed thing the `edit` Verb opened (#274)
  const edit = (ref: unknown, eid: unknown, patch: unknown) => {
    if (!Number.isInteger(eid) || !isMap(patch)) {
      send({
        event: 'reply',
        ok: false,
        reason: 'an edit needs an eid and a patch'
      });
      return;
    }
    return building(ref, (a, c) => mua.edit(a, c, eid as Eid, patch));
  };

  // Storing or destroying the placed thing the `edit` Verb opened, from
  // the Composer, as the `store` and `destroy` Verbs do (#284)
  const putAway = (ref: unknown, eid: unknown, verb: 'destroy' | 'store') => {
    if (!Number.isInteger(eid)) {
      send({
        event: 'reply',
        ok: false,
        reason: 'it needs the eid of the thing'
      });
      return;
    }
    return building(ref, async (a, c) => {
      const done = await mua.putAway(a, c, eid as Eid, verb);
      return { eid: done.eid, max_placed: done.maxPlaced, placed: done.placed };
    });
  };

  // Closing the Composer without saving: the client asked, so no `closed`
  const stopEditing = async (ref: unknown) => {
    const safeRef = isRef(ref) ? ref : undefined;
    if (account === undefined || character === undefined) {
      send({ event: 'reply', ok: false, reason: 'not_joined', ref: safeRef });
      return;
    }
    try {
      await mua.stopEditing(account, character);
      composing = undefined;
      editingChanged = false;
      send({ event: 'reply', ok: true, ref: safeRef });
    } catch (error) {
      send({ event: 'reply', ok: false, reason: fail(error), ref: safeRef });
    }
  };

  // A mirror of what the Character perceives, for Try it (#259, #291)
  const snapshot = async () => {
    let mirror;
    if (account !== undefined && character !== undefined) {
      try {
        mirror = await mua.mirror(account, character);
      } catch (error) {
        fail(error);
      }
    }
    send({ event: 'snapshot', snapshot: mirror });
  };

  const logout = async () => {
    if (account !== undefined && character !== undefined) {
      unsubscribe?.();
      unsubscribe = undefined;
      composing = undefined;
      editingChanged = false;
      await mua.leave(account, character);
    }
    send({ event: 'status', status: 'limbo' });
  };

  return {
    /** Handles one message from the UI */
    receive: (message: ToWorld) => {
      switch (message.type) {
        case 'join':
          return join(message.name);
        case 'command':
          return command(message.ref, message.text);
        case 'logout':
          return logout();
        case 'place':
          return place(message.ref, message.composition);
        case 'edit':
          return edit(message.ref, message.eid, message.patch);
        case 'store':
        case 'destroy':
          return putAway(message.ref, message.eid, message.type);
        case 'stop_editing':
          return stopEditing(message.ref);
        case 'snapshot':
          return snapshot();
      }
    },
    /** Closes the World's database */
    close: () => {
      unsubscribe?.();
      store.db.close();
    },
    /** The World as an SQLite file's bytes, between Steps */
    save: () => store.db.export(),
    /**
     * Runs what is due at World time, and tells the client if that closed
     * what it has open; the Worker calls it on a timer
     */
    tick: async () => {
      await mua.tick();
      if (editingChanged) {
        await compose();
      }
    },
    world: mua
  };
};

export type LocalWorld = Awaited<ReturnType<typeof openLocalWorld>>;

/**
 * A Local World's host, as its Worker runs it: it opens the World on the
 * first message, and handles saving it and loading a save in its place
 * (#219). A save is the World's database file (ADR 0023). A loaded file
 * that isn't a World this can play is refused, and the World is put back as
 * it was. Messages must come one at a time.
 */
export const createLocalHost = (options: LocalWorldOptions) => {
  const { send } = options;
  let world: LocalWorld | undefined;

  const open = async (requireBuilt = false) => {
    world ??= await openLocalWorld({ ...options, requireBuilt });
    return world;
  };

  const load = async (bytes: Uint8Array) => {
    if (!isSqliteFile(bytes)) {
      send({ event: 'loadFailed', message: 'That file is not a saved World' });
      return;
    }
    const backup = (await open()).save();
    world!.close();
    world = undefined;
    try {
      await replaceDatabase(options.database, bytes);
      await open(true);
      send({ event: 'loaded' });
    } catch (error) {
      // a file that opened but failed after holds the database: let it go
      (world as LocalWorld | undefined)?.close();
      world = undefined;
      await replaceDatabase(options.database, backup);
      await open();
      send({
        event: 'loadFailed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  return {
    receive: async (message: ToWorld) => {
      switch (message.type) {
        case 'save':
          send({ bytes: (await open()).save(), event: 'saved' });
          return;
        case 'load':
          return load(message.bytes);
        default:
          return (await open()).receive(message);
      }
    },
    /** Runs what is due, once the World is open */
    tick: () => world?.tick(),
    /** The open World, if it is open */
    world: () => world
  };
};

export type LocalHost = ReturnType<typeof createLocalHost>;
