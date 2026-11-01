import type { Components, EntityWithComponents, GenericEntity } from '../types';
import { applyComponentDefaults } from './defaults';
import { makeTrackedComponent } from './helpers/make-tracked';

export const addComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName,
  data: TWorldComponents[TComponentName]
): EntityWithComponents<TWorldComponents, TComponentName> => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  // Check if component already exists and has been persisted
  const existingComponent =
    world.entityCache.get(id)?.[componentName as string];
  const isUpdate = existingComponent !== undefined && existingComponent.exists;

  // Apply default values from the component schema
  const dataWithDefaults = applyComponentDefaults(
    world,
    componentName as string,
    data as Record<string, unknown>
  );

  (entity as Record<PropertyKey, unknown>)[componentName] =
    makeTrackedComponent(
      entity,
      componentName,
      dataWithDefaults as TWorldComponents[TComponentName],
      isUpdate // mark as existing if updating, new if adding
    ) as TWorldComponents[TComponentName];

  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);

  return entity as EntityWithComponents<TWorldComponents, TComponentName>;
};

export const addComponents = <
  TWorldComponents extends Components,
  TComponentData extends Partial<{
    [K in keyof TWorldComponents]: TWorldComponents[K];
  }>
>(
  entity: GenericEntity<TWorldComponents>,
  components: TComponentData
): EntityWithComponents<
  TWorldComponents,
  keyof TComponentData & keyof TWorldComponents
> => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  for (const [componentName, data] of Object.entries(components)) {
    // Apply default values from the component schema
    const dataWithDefaults = applyComponentDefaults(world, componentName, data);

    (entity as Record<PropertyKey, unknown>)[componentName] =
      makeTrackedComponent(
        entity,
        componentName,
        dataWithDefaults,
        false // mark as new
      );

    if (!world.dirtyEntities.has(id)) {
      world.dirtyEntities.set(id, new Set());
    }
    world.dirtyEntities.get(id)!.add(componentName);
  }

  return entity as EntityWithComponents<
    TWorldComponents,
    keyof TComponentData & keyof TWorldComponents
  >;
};
