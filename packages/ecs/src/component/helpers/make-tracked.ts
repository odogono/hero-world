import type { Components, GenericEntity } from '../../types';

export const makeTrackedComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName,
  data: TWorldComponents[TComponentName],
  exists = true,
  /**
   * `read` when the data has just been loaded from the database by a query;
   * `write` when the caller is setting the component's value.
   */
  mode: 'read' | 'write' = 'write'
): TWorldComponents[TComponentName] => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  if (mode === 'write') {
    world.noteChange(id);
  }

  let cache = world.entityCache.get(id);
  if (!cache) {
    cache = {};
    world.entityCache.set(id, cache);
  }

  // Every copy of this entity hands out the same data object for a component,
  // so a change made through one copy is seen, and saved, through all of them.
  // A query (`read`) must not overwrite unsaved changes with what it loaded.
  const cached = cache[componentName];
  const isDirty = world.dirtyEntities.get(id)?.has(componentName) ?? false;
  let tracked = data as Record<PropertyKey, unknown>;
  if (cached && typeof cached.data === 'object' && cached.data !== null) {
    tracked = cached.data as Record<PropertyKey, unknown>;
    const keepPending = mode === 'read' && isDirty;
    if (!keepPending && tracked !== data) {
      // Overwrite in place, deleting only keys `data` lacks: deleting every
      // key would make the engine give up the object's fast layout
      const fresh = data as Record<PropertyKey, unknown>;
      for (const key of Object.keys(tracked)) {
        if (!(key in fresh)) {
          delete tracked[key];
        }
      }
      Object.assign(tracked, fresh);
    }
    // a read can only confirm the row exists; a write knows best
    cached.exists = mode === 'read' ? cached.exists || exists : exists;
  } else {
    cache[componentName] = {
      data,
      exists
    };
  }

  return new Proxy(tracked, {
    set(target, prop, value) {
      world.noteChange(id);
      target[prop] = value;
      if (!world.dirtyEntities.has(id)) {
        world.dirtyEntities.set(id, new Set());
      }
      world.dirtyEntities.get(id)!.add(componentName);
      return true;
    }
  }) as TWorldComponents[TComponentName];
};
