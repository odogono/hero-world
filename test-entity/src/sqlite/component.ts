import type { Entity, Components, ComponentDefinition } from "./types";
import type { EntityWithComponents } from "./entity";
import * as z from "zod";
import { componentSchema } from "./types";
import { toSnakeCase } from "../helpers/string";




interface DefineComponentExOptions<Name extends string> {
  name: Name;
  schema: Record<string, z.ZodTypeAny>;
  statements?: Record<string, string>;
  tableName?: string;
  meta?: Record<string, any>;
}

export const defineComponent = <
  Name extends string
>(options: DefineComponentExOptions<Name>) => {
  const { name, statements } = options;
  const tableName = options.tableName || `tbl_${toSnakeCase(name)}`;

  const meta = {
    ...options.meta,
    id: name,
    name: tableName
  }

  const schema = componentSchema.extend(options.schema).meta(meta);
  
  return {
    name,
    schema,
    statements,
  } as ComponentDefinition<Name, typeof schema>;
};

export const makeTrackedComponent = <T extends keyof Components>(
  entity: Entity,
  componentName: T,
  data: Components[T],
  exists = true
): Components[T] => {
  const { id, world } = entity;
  if (!world.entityCache.has(id)) {world.entityCache.set(id, {});}
  (world.entityCache.get(id) as any)[componentName] = {
    data,
    exists,
  };
  
  return new Proxy(data as any, {
    set(target, prop, value) {
      (target as any)[prop] = value;
      if (!world.dirtyEntities.has(id)) {
        world.dirtyEntities.set(id, new Set());
      }
      world.dirtyEntities.get(id)!.add(componentName);
      return true;
    },
  });
}


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
}


export const removeComponent = <T extends keyof Components>(
  entity: Entity<any> | EntityWithComponents<any, any>,
  componentName: T
) => {
  const { id, world } = entity;
  const def = world.defs.get(componentName);
  if (!def) {
    throw new Error(`Component def not found for ${componentName}`);
  }

  // delete from db
  world.db.query(`DELETE FROM ${def.tableName} WHERE eid = ?1`).run(id);
  
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