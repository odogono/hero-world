import { components, type MirrorRow, type MirrorSnapshot } from 'mua-world';
import type { CreateDatabaseOptions } from 'odgn-ecs/db';
import {
  components as componentsOf,
  putMany,
  query,
  remove,
  type Eid,
  type Store
} from 'odgn-ecs/store';
import { createWorld } from 'odgn-ecs/world';

/** The server's `mirror` message, as both Hosts give it (#291) */
export type { MirrorRow, MirrorSnapshot };

/** The server's `changes` message, after a Step */
export type MirrorChangeSet = {
  gone: Eid[];
  place: Eid | null;
  put: Record<string, MirrorRow[]>;
  remove: Record<string, Eid[]>;
};

/** From the UI to the mirror's Worker (`mirror-worker.ts`) */
export type ToMirror =
  | { snapshot: MirrorSnapshot; type: 'load' }
  | { changes: MirrorChangeSet; type: 'apply' }
  /** Asks for the mirror as it is now, for Try it (#259) */
  | { type: 'snapshot' };

/** From the mirror's Worker: the reply to `snapshot`, or nothing yet */
export type FromMirror = {
  event: 'snapshot';
  snapshot: MirrorSnapshot | undefined;
};

/**
 * A client's mirror of the server's World (#164, ADR 0019): a World in the
 * shared layout holding only what its Character perceives. A `load` replaces
 * it whole, as on every connect; each `apply` brings it up to the Step the
 * server just committed. Nothing is replayed after a reconnect.
 *
 * The server sends only some fields, so a component read here may show a
 * default where the server's World holds a value the Character can't see.
 */
export const openMirror = async (database: CreateDatabaseOptions) => {
  const world = await createWorld(components, database);
  const store: Store = world.store;
  // a mirror holds part of the World: a Reference may name an entity it
  // doesn't hold, and dropping one mustn't touch what refers to it
  store.db.exec('PRAGMA foreign_keys = OFF');

  let character: Eid | undefined;
  let place: Eid | null = null;

  const ensure = (eids: Iterable<Eid>) => {
    for (const eid of eids) {
      store.db.exec('INSERT OR IGNORE INTO entities (eid) VALUES (?1)', [eid]);
    }
  };

  // with foreign keys off, an entity's rows don't go with it by themselves
  const drop = (eid: Eid) => {
    for (const name of store.components.keys()) {
      remove(store, eid, name);
    }
    store.db.exec('DELETE FROM entities WHERE eid = ?1', [eid]);
  };

  const putRows = (rows: Record<string, MirrorRow[]>) => {
    for (const [name, list] of Object.entries(rows)) {
      if (!store.components.has(name)) {
        continue;
      }
      ensure(list.map(r => r.eid));
      putMany(
        store,
        name,
        list.map(({ eid, ...data }) => [eid, data] as const)
      );
    }
  };

  return {
    /** Applies one Step's change set */
    apply: (changes: MirrorChangeSet) => {
      store.db.transaction(() => {
        for (const eid of changes.gone) {
          drop(eid);
        }
        for (const [name, eids] of Object.entries(changes.remove)) {
          if (store.components.has(name)) {
            for (const eid of eids) {
              remove(store, eid, name);
            }
          }
        }
        putRows(changes.put);
      });
      place = changes.place;
    },

    /** The Character the mirror is of, once loaded */
    get character() {
      return character;
    },

    close: () => store.db.close(),

    /** Replaces the mirror with a fresh snapshot */
    load: (snapshot: MirrorSnapshot) => {
      store.db.transaction(() => {
        const held = store.db.query('SELECT eid FROM entities') as {
          eid: Eid;
        }[];
        for (const { eid } of held) {
          drop(eid);
        }
        putRows(snapshot.components);
      });
      character = snapshot.character;
      place = snapshot.place;
    },

    /** The Character's place, or null when it has none */
    get place() {
      return place;
    },

    /**
     * The mirror as it is now, as a snapshot, or undefined before one is
     * loaded. A field the server didn't send reads as its default.
     */
    snapshot: (): MirrorSnapshot | undefined => {
      if (character === undefined) {
        return undefined;
      }
      const rows: Record<string, MirrorRow[]> = {};
      for (const eid of query(store, {})) {
        for (const [name, data] of Object.entries(componentsOf(store, eid))) {
          (rows[name] ??= []).push({ ...data, eid });
        }
      }
      return { character, components: rows, place };
    },

    store
  };
};

export type Mirror = Awaited<ReturnType<typeof openMirror>>;
