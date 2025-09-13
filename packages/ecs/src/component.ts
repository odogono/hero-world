import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';
import { z } from 'zod';

import {
  type ComponentDefinition,
  type Components,
  type EntityWithComponents,
  type GenericEntity,
  type World
} from '@types';

import { extractDefaults } from './schema';

export { z };

type DefineComponentExOptions<
  Name extends string,
  Shape extends z.ZodRawShape
> = {
  meta?: Record<string, any>;
  name: Name;
  schema: Shape;
  statements?: Record<string, string>;
  tableName?: string;
};

const componentSchema = z.object({
  id: z.int().optional().meta({ autoIncrement: true, primaryKey: true }),
  // eslint-disable-next-line perfectionist/sort-objects
  eid: z.int().optional().meta({ cascade: true, foreignKey: 'tbl_entity' })
});
type ComponentSchemaBase = z.infer<typeof componentSchema>;

export const defineComponent = <
  Name extends string,
  Shape extends z.ZodRawShape
>(
  options: DefineComponentExOptions<Name, Shape>
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
    data as Partial<TWorldComponents[TComponentName]>
  );

  (entity as any)[componentName] = makeTrackedComponent(
    entity,
    componentName,
    dataWithDefaults,
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
): EntityWithComponents<TWorldComponents, keyof TComponentData> => {
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

  return entity as EntityWithComponents<TWorldComponents, keyof TComponentData>;
};

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
