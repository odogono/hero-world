import type { Components, GenericEntity } from '@types';

/**
 * Mark a component for deferred deletion (will be deleted on next flush)
 * This follows the same pattern as addComponent
 */
export const removeComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName
): void => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  // Mark component for deletion in cache
  const cache = world.entityCache.get(id);
  if (cache && cache[componentName as string]) {
    const cacheEntry = cache[componentName as string];
    cacheEntry.exists = false; // Mark as deleted
    cacheEntry.data = null; // Clear the data
  }

  // Remove from entity object
  delete (entity as any)[componentName];

  // Mark entity as dirty for this component
  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);
};
