import type { Entity, Components } from "./types";
import type { World } from "./world";



export const makeTrackedComponent = <T extends keyof Components>(
  world: World,
  eid: number,
  componentName: T,
  data: Components[T],
  exists = true
): Components[T] => {
  if (!world.entityCache.has(eid)) world.entityCache.set(eid, {});
  (world.entityCache.get(eid) as any)[componentName] = {
    data,
    exists,
  };
  
  return new Proxy(data as any, {
    set(target, prop, value) {
      (target as any)[prop] = value;
      if (!world.dirtyEntities.has(eid)) {
        world.dirtyEntities.set(eid, new Set());
      }
      world.dirtyEntities.get(eid)!.add(componentName);
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
    world,
    id,
    componentName,
    data,
    false // mark as new
  ) as Components[T];

  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);
}