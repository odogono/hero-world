import type { Components, GenericEntity } from '@types';

export const makeTrackedComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName,
  data: TWorldComponents[TComponentName],
  exists = true
): TWorldComponents[TComponentName] => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  let cache = world.entityCache.get(id);
  if (!cache) {
    cache = {};
    world.entityCache.set(id, cache);
  }
  cache[componentName] = {
    data,
    exists
  };

  return new Proxy(data as Record<PropertyKey, unknown>, {
    set(target, prop, value) {
      // console.debug('[makeTrackedComponent] set', prop, value);
      target[prop] = value;
      if (!world.dirtyEntities.has(id)) {
        world.dirtyEntities.set(id, new Set());
      }
      world.dirtyEntities.get(id)!.add(componentName);
      return true;
    }
  }) as TWorldComponents[TComponentName];
};
