import { toSnakeCase } from 'odgn-helpers';
import { z } from 'zod';

import {
  type ComponentDefinition,
  type Components,
  type Entity,
  type EntityWithComponents
} from '@types';

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
  const { name, statements } = options;
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
  if (!world.entityCache.has(id)) {
    world.entityCache.set(id, {});
  }
  (world.entityCache.get(id) as any)[componentName] = {
    data,
    exists
  };

  return new Proxy(data as any, {
    set(target, prop, value) {
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
  (entity as any)[componentName] = makeTrackedComponent(
    entity,
    componentName,
    data,
    false // mark as new
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

  for (const [componentName, data] of Object.entries(components)) {
    (entity as any)[componentName] = makeTrackedComponent(
      entity,
      componentName,
      data,
      false // mark as new
    );

    if (!world.dirtyEntities.has(id)) {
      world.dirtyEntities.set(id, new Set());
    }
    world.dirtyEntities.get(id)!.add(componentName);
  }

  return entity as E & { [K in keyof T]: T[K] };
};

// Overloaded function signatures for removeComponent
export function removeComponent(
  entity: Entity<any> | EntityWithComponents<any, any>
): void;

export function removeComponent<T extends keyof Components>(
  entity: Entity<any> | EntityWithComponents<any, any>,
  componentName: T
): void;

export function removeComponent<T extends keyof Components>(
  entity: Entity<any> | EntityWithComponents<any, any>,
  ...componentNames: T[]
): void;

export function removeComponent<T extends keyof Components>(
  entity: Entity<any> | EntityWithComponents<any, any>,
  ...componentNames: T[]
): void {
  const { id, world } = entity;

  // If no component names provided, remove all components from the entity
  if (componentNames.length === 0) {
    const cache = entity.world.entityCache.get(id);
    if (cache) {
      // Get all component names from the cache
      const allComponentNames = Object.keys(cache);

      for (const componentName of allComponentNames) {
        const def = world.defs.get(componentName);
        if (def) {
          // delete from db
          world.db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, id);
        }

        delete (cache as any)[componentName];
        delete (entity as any)[componentName];
      }
    }

    // Clean up dirty tracking
    world.dirtyEntities.delete(id);
    return;
  }

  // Remove specific components
  for (const componentName of componentNames) {
    const def = world.defs.get(componentName);
    if (!def) {
      throw new Error(`Component def not found for ${componentName}`);
    }

    // delete from db
    world.db.exec(`DELETE FROM ${def.tableName} WHERE eid = ?1`, id);

    const cache = entity.world.entityCache.get(id);
    if (cache) {
      delete (cache as any)[componentName];
    }

    delete (entity as any)[componentName];

    const dirty = entity.world.dirtyEntities.get(id);
    if (dirty) {
      dirty.delete(componentName);
      if (dirty.size === 0) {
        world.dirtyEntities.delete(id);
      }
    }
  }
}
