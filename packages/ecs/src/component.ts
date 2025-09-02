import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';
import { z } from 'zod';

import {
  type ComponentDefinition,
  type Components,
  type Entity,
  type EntityWithComponents,
  type World
} from '@types';

import { extractDefaults } from './schema';

type DefineComponentExOptions<Name extends string> = {
  meta?: Record<string, any>;
  name: Name;
  schema: Record<string, z.ZodTypeAny>;
  statements?: Record<string, string>;
  tableName?: string;
};

const componentSchema = z.object({
  id: z.int().optional().meta({ autoIncrement: true, primaryKey: true }),
  // eslint-disable-next-line perfectionist/sort-objects
  eid: z.int().optional().meta({ cascade: true, foreignKey: 'tbl_entity' })
});

export const defineComponent = <Name extends string>(
  options: DefineComponentExOptions<Name>
) => {
  const name = toCamelCase(options.name);
  const { statements } = options;
  const tableName = options.tableName || `tbl_${toSnakeCase(name)}`;

  const meta = {
    ...options.meta,
    id: name,
    name: tableName
  };

  const schema = componentSchema.extend(options.schema).meta(meta);

  return {
    name,
    schema,
    statements
  } as ComponentDefinition<Name, typeof schema>;
};

export const makeTrackedComponent = <T extends keyof Components>(
  entity: Entity,
  componentName: T,
  data: Components[T],
  exists = true
): Components[T] => {
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

export const addComponent = <
  E extends Entity<any> | EntityWithComponents<any, any>,
  T extends keyof Components
>(
  entity: E,
  componentName: T,
  data: Components[T]
): E & { [K in T]: Components[T] } => {
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
    data as Partial<Components[T]>
  );

  (entity as any)[componentName] = makeTrackedComponent(
    entity,
    componentName,
    dataWithDefaults,
    isUpdate // mark as existing if updating, new if adding
  ) as Components[T];

  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);

  return entity as E & { [K in T]: Components[T] };
};

export const addComponents = <
  E extends Entity<any> | EntityWithComponents<any, any>,
  T extends Record<string, any>
>(
  entity: E,
  components: T
): E & { [K in keyof T]: T[K] } => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  for (const [componentName, data] of Object.entries(components)) {
    // Apply default values from the component schema
    const dataWithDefaults = applyComponentDefaults(world, componentName, data);

    (entity as any)[componentName] = makeTrackedComponent(
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

  return entity as E & { [K in keyof T]: T[K] };
};

/**
 * Mark a component for deferred deletion (will be deleted on next flush)
 * This follows the same pattern as addComponent
 */
export const removeComponent = <
  E extends Entity<any> | EntityWithComponents<any, any>,
  T extends keyof Components
>(
  entity: E,
  componentName: T
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

/**
 * Apply default values from a Zod schema to component data
 * This function merges the provided data with default values from the schema
 */
export const applyDefaults = <T>(schema: z.ZodType<T>, data: Partial<T>): T => {
  const defaults = extractDefaults(schema);

  // Merge defaults with provided data, with provided data taking precedence
  const merged = { ...defaults, ...data };

  // Validate the merged data against the schema
  return schema.parse(merged);
};

/**
 * Apply default values to component data using the world's component definitions
 * This function looks up the component schema and applies defaults
 */
export const applyComponentDefaults = <T extends Components>(
  world: World<T>,
  componentName: string,
  data: any
): any => {
  const def = world.defs.get(componentName);
  if (!def || !def.schema) {
    // If no schema found, return data as-is
    return data;
  }

  try {
    return applyDefaults(def.schema, data);
  } catch (error) {
    // If validation fails, log error and return data as-is
    console.warn(
      `Failed to apply defaults for component ${componentName}:`,
      error
    );
    return data;
  }
};
