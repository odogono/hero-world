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

  if (!world.entityCache.has(id)) {
    world.entityCache.set(id, {});
  }
  (world.entityCache.get(id) as any)[componentName] = {
    data,
    exists
  };

  return new Proxy(data as any, {
    set(target, prop, value) {
      // console.debug('[makeTrackedComponent] set', prop, value);
      (target as any)[prop] = value;
      if (!world.dirtyEntities.has(id)) {
        world.dirtyEntities.set(id, new Set());
      }
      world.dirtyEntities.get(id)!.add(componentName);
      return true;
    }
  });
};
