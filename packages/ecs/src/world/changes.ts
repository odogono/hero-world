import type { Components } from '../types';
import type { World } from './index';

/** What an entity's pending state was before a Change Scope first touched it */
type EntitySnapshot = {
  /** The entity was created inside the scope */
  created: boolean;
  deleting: boolean;
  dirty?: Set<PropertyKey>;
  /** The cache entries, each with its data object and a copy of its fields */
  entries?: Map<
    string,
    { data: Record<string, unknown> | null; exists: boolean; fields: unknown }
  >;
};

/** A write touched an entity that another open Change Scope holds */
export class ChangeConflictError extends Error {
  readonly eid: number;
  constructor(eid: number) {
    super(`Entity ${eid} is held by another change scope`);
    this.name = 'ChangeConflictError';
    this.eid = eid;
  }
}

/**
 * A group of pending changes that is committed into the World's pending
 * changes, or discarded as if it never happened. Writes join it inside
 * `run`. Each entity it touches is held until it closes: another scope's
 * write to it, or one outside any scope, throws `ChangeConflictError`, and
 * `flush()` leaves its changes pending.
 */
export class ChangeScope<TComponents extends Components = Components> {
  readonly world: World<TComponents>;
  private snapshots = new Map<number, EntitySnapshot>();
  private open = true;

  constructor(world: World<TComponents>) {
    this.world = world;
  }

  get isOpen() {
    return this.open;
  }

  /** The entities this scope has touched */
  get entities(): number[] {
    return [...this.snapshots.keys()];
  }

  /** Run `fn` with its writes joining this scope */
  run<R>(fn: () => R): R {
    if (!this.open) {
      throw new Error('Change scope is closed');
    }
    const { world } = this;
    const previous = world.activeChanges;
    world.activeChanges = this as unknown as ChangeScope<TComponents>;
    try {
      return fn();
    } finally {
      world.activeChanges = previous;
    }
  }

  /** Keep this scope's changes as the World's pending changes */
  commit() {
    this.close();
  }

  /** Put every entity this scope touched back as it was before */
  discard() {
    if (!this.open) {
      return;
    }
    const { world } = this;
    for (const [eid, snapshot] of this.snapshots) {
      if (snapshot.created) {
        world.db.exec('DELETE FROM entities WHERE eid = ?1', eid);
        world.entityCache.delete(eid);
        world.dirtyEntities.delete(eid);
        world.entitiesToDelete.delete(eid);
        continue;
      }
      restore(world, eid, snapshot);
    }
    this.close();
  }

  private close() {
    if (!this.open) {
      return;
    }
    this.open = false;
    for (const eid of this.snapshots.keys()) {
      if (this.world.changeHolders.get(eid) === this) {
        this.world.changeHolders.delete(eid);
      }
    }
    this.snapshots.clear();
  }

  /** @internal Called by the World before an entity's pending state changes */
  noteChange(eid: number, created = false) {
    if (this.snapshots.has(eid)) {
      return;
    }
    const { world } = this;
    const cache = world.entityCache.get(eid);
    const snapshot: EntitySnapshot = {
      created,
      deleting: world.entitiesToDelete.has(eid),
      dirty: world.dirtyEntities.has(eid)
        ? new Set(world.dirtyEntities.get(eid))
        : undefined
    };
    if (cache && !created) {
      snapshot.entries = new Map();
      for (const [name, entry] of Object.entries(cache)) {
        if (!entry) {
          continue;
        }
        const data = entry.data as Record<string, unknown> | null;
        snapshot.entries.set(name, {
          data,
          exists: entry.exists,
          fields: data === null ? null : structuredClone({ ...data })
        });
      }
    }
    this.snapshots.set(eid, snapshot);
    world.changeHolders.set(eid, this as unknown as ChangeScope<TComponents>);
  }
}

const restore = <TComponents extends Components>(
  world: World<TComponents>,
  eid: number,
  snapshot: EntitySnapshot
) => {
  if (snapshot.entries) {
    const cache: Record<string, unknown> = {};
    for (const [name, { data, exists, fields }] of snapshot.entries) {
      // restore the same data object, so tracked proxies still see it
      if (data !== null) {
        for (const key of Object.keys(data)) {
          delete data[key];
        }
        Object.assign(data, fields);
      }
      cache[name] = { data, exists };
    }
    world.entityCache.set(eid, cache as never);
  } else {
    world.entityCache.delete(eid);
  }

  if (snapshot.dirty) {
    world.dirtyEntities.set(eid, new Set(snapshot.dirty) as never);
  } else {
    world.dirtyEntities.delete(eid);
  }

  if (snapshot.deleting) {
    world.entitiesToDelete.add(eid);
  } else {
    world.entitiesToDelete.delete(eid);
  }
};
