import type { Entity, Component } from '@types';
import type { World } from '@/world';

export const createEntity = (world: World) => {
  const id = world.entities.length + 1;
  world.entities.push(id);
  return id;
};


export const isEntity = (val: unknown): val is Entity => {
  return typeof val === 'number';
}


export const getEComponents = (world: World, entity: Entity): Component[] => {
  const result: Component[] = [];
  const location = world.entityLocations.get(entity);
  const stats = world.entityStats.get(entity);
  const hitPoints = world.entityHitPoints.get(entity);
  if (location) {
    result.push(location);
  }
  if (stats) {
    result.push(stats);
  }
  if (hitPoints) {
    result.push(hitPoints);
  }
  return result;
}
