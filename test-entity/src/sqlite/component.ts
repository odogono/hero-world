import type { Entity, Components } from "./types";
import * as z from "zod";

export const componentSchema = z.object({
  id: z.int().optional().meta({ primaryKey: true, autoIncrement: true }),
  eid: z.int().optional().meta({ foreignKey: 'tbl_entity', cascade: true }),
});

export const makeTrackedComponent = <T extends keyof Components>(
  entity: Entity,
  componentName: T,
  data: Components[T],
  exists = true
): Components[T] => {
  const { id, world } = entity;
  if (!world.entityCache.has(id)) world.entityCache.set(id, {});
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


export const addComponent = <T extends keyof Components>(
  entity: Entity<any>,
  componentName: T,
  data: Components[T]
) => {
  const { id, world } = entity;
  entity[componentName] = makeTrackedComponent(
    entity,
    componentName,
    data,
    false // mark as new
  ) as Components[T];

  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);
}


export const removeComponent = <T extends keyof Components>(
  entity: Entity<any>,
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