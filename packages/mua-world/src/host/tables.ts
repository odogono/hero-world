import { ensureTables, takeWaiting } from 'ecs-engine';
import { elements } from 'ecs-talk';
import { get, type Eid, type Store } from 'odgn-ecs/store';

/**
 * mua's own tables, beside the ECS's and the engine's, as
 * `MuaWorld.Tables`: each Step's outbox, notices left from a restart and the
 * NPC queue. Sign-in identities are the server's, so a Local World has none.
 */
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS mua_outbox (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL, suggestions TEXT, picture TEXT)',
  'CREATE TABLE IF NOT EXISTS mua_notices (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS mua_identities (sub TEXT PRIMARY KEY, email TEXT, account INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS mua_npc_queue (id INTEGER PRIMARY KEY, actor INTEGER NOT NULL, text TEXT NOT NULL)'
];

const rows = <T>(store: Store, sql: string, args: unknown[] = []) =>
  (args.length > 0 ? store.db.query(sql, args) : store.db.query(sql)) as T[];

/** Creates mua's tables and the engine's */
export const ensureMuaTables = (store: Store) => {
  ensureTables(store);
  for (const sql of SCHEMA) {
    store.db.exec(sql);
  }
  // a World made before a line could offer Suggestions (#275, #292)
  const hasSuggestions =
    rows(
      store,
      "SELECT 1 FROM pragma_table_info('mua_outbox') WHERE name = 'suggestions'"
    ).length > 0;
  if (!hasSuggestions) {
    store.db.exec('ALTER TABLE mua_outbox ADD COLUMN suggestions TEXT');
  }
  // a World made before places had Pictures (ADR 0027)
  const hasPicture =
    rows(
      store,
      "SELECT 1 FROM pragma_table_info('mua_outbox') WHERE name = 'picture'"
    ).length > 0;
  if (!hasPicture) {
    store.db.exec('ALTER TABLE mua_outbox ADD COLUMN picture TEXT');
  }
};

/** The Characters (entities with `player`) whose Location is `place` */
export const charactersAt = (store: Store, place: Eid): Eid[] =>
  elements(store, place, { with: ['player'] });

/**
 * A place's Picture (ADR 0027): its `src` beside the EDL, the URL it is
 * served at, and the place's name and description, which stand in for it
 * where it isn't shown
 */
export type Picture = { alt: string; name: string; src: string; url: string };

/** What a Character is told: a line of text, or a place's Picture */
export type Told = string | { picture: Picture };

/**
 * A line a Character is told, and the Commands it offers to send with one
 * click (#275), as `MuaWorld.Tables` keeps them
 */
export type Line = [character: Eid, told: Told, suggestions?: string[]];

/**
 * Queues a line for a Character, once the Step commits. `suggestions` are
 * Commands the line offers the player to send with one click (#275).
 */
export const output = (
  store: Store,
  character: Eid,
  text: string,
  suggestions: string[] = []
) =>
  suggestions.length > 0
    ? store.db.exec(
        'INSERT INTO mua_outbox (character, text, suggestions) VALUES (?1, ?2, ?3)',
        [character, text, JSON.stringify(suggestions)]
      )
    : store.db.exec(
        'INSERT INTO mua_outbox (character, text) VALUES (?1, ?2)',
        [character, text]
      );

/**
 * Queues a place's Picture for a Character, once the Step commits. Its
 * `text` is the place's name, for anything that reads lines as text.
 */
export const outputPicture = (store: Store, character: Eid, picture: Picture) =>
  store.db.exec(
    'INSERT INTO mua_outbox (character, text, picture) VALUES (?1, ?2, ?3)',
    [character, picture.name, JSON.stringify(picture)]
  );

/**
 * Tells an entity something: a Character hears it; any other entity (a
 * room, a box) passes it to the Characters inside it, but for `except`.
 */
export const tell = (store: Store, to: Eid, text: string, except?: Eid) => {
  if (get(store, to, 'player')) {
    output(store, to, text);
    return;
  }
  for (const c of charactersAt(store, to)) {
    if (c !== except) {
      output(store, c, text);
    }
  }
};

/**
 * Takes the Step's output, inside the Step's transaction: each line with
 * its Suggestions, when it offers any, or a place's Picture
 */
export const takeOutbox = (store: Store): Line[] => {
  const out = rows<{
    character: Eid;
    picture: string | null;
    suggestions: string | null;
    text: string;
  }>(
    store,
    'SELECT character, text, suggestions, picture FROM mua_outbox ORDER BY id'
  );
  store.db.exec('DELETE FROM mua_outbox');
  return out.map(({ character, picture, suggestions, text }): Line => {
    if (picture !== null) {
      const { alt, name, src, url } = JSON.parse(picture) as Picture;
      return [character, { picture: { alt, name, src, url } }];
    }
    return suggestions === null
      ? [character, text]
      : [character, text, JSON.parse(suggestions) as string[]];
  });
};

/**
 * Turns every input left waiting at the last stop into a notice for its
 * Character, and clears the outbox. Returns how many were abandoned.
 */
export const abandonWaiting = (store: Store): number => {
  const waiting = takeWaiting(store);
  for (const { actor, input } of waiting) {
    if (actor !== null) {
      store.db.exec(
        'INSERT INTO mua_notices (character, text) VALUES (?1, ?2)',
        [actor, `The world was restarted, and "${input}" was abandoned.`]
      );
    }
  }
  store.db.exec('DELETE FROM mua_outbox');
  return waiting.length;
};

export const takeNotices = (store: Store, character: Eid): string[] => {
  const notices = rows<{ text: string }>(
    store,
    'SELECT text FROM mua_notices WHERE character = ?1 ORDER BY id',
    [character]
  ).map(r => r.text);
  store.db.exec('DELETE FROM mua_notices WHERE character = ?1', [character]);
  return notices;
};

/** A queued NPC command: a line to parse, or one already bound */
export type Act = Record<string, unknown> | string;

/**
 * Queues a command an NPC's Script asked it to carry out (`mua act`), kept
 * as `MuaWorld.Tables` keeps it: a line of text, or `{"bound": command}`
 */
export const queueAct = (store: Store, actor: Eid, command: Act) =>
  store.db.exec('INSERT INTO mua_npc_queue (actor, text) VALUES (?1, ?2)', [
    actor,
    typeof command === 'string' ? command : JSON.stringify({ bound: command })
  ]);

const decodeAct = (text: string): Act => {
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { bound?: unknown };
      if (parsed.bound && typeof parsed.bound === 'object') {
        return parsed.bound as Record<string, unknown>;
      }
    } catch {
      // a line that happens to start with a brace
    }
  }
  return text;
};

/** The queued NPC commands, oldest first */
export const queuedActs = (store: Store) =>
  rows<{ actor: Eid; id: number; text: string }>(
    store,
    'SELECT id, actor, text FROM mua_npc_queue ORDER BY id'
  ).map(({ actor, id, text }) => ({ act: decodeAct(text), actor, id }));

export const deleteAct = (store: Store, id: number) =>
  store.db.exec('DELETE FROM mua_npc_queue WHERE id = ?1', [id]);
