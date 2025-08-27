import type { Component, Entity } from '@types';
import { createEntity, isEntity } from './index';
import type { World } from '@/world';
import { objectHasProperties } from './helpers';

export type Location = Component & {
  name: string;
  region: string;
}


export const createLocation = (world: World, location: Partial<Location>) => {
  const id = world.components.length;
  const cLocation: Location = {
    id,
    name: '',
    region: '',
    ...location,
  };
  world.components.push(cLocation);
  const e = createEntity(world);
  world.locations.set(e, cLocation);
  return e;
}

export const getLocationByE = (world: World, id: Entity): Location | null => {
  const entityLocation = world.entityLocations.get(id);
  if (!entityLocation) {
    return null;
  }
  return world.locations.get(entityLocation.location) ?? null;
}

export const getLocation = (world: World,  location: Entity | Partial<Location>): Location | null => {
  if (isEntity(location)) {
    return world.locations.get(location) ?? null;
  }

  for (const [id, loc] of world.locations) {
    if (objectHasProperties(loc, location)) {
      return loc;
    }
  }
  return null;
}

export const getLocationE = (world: World,  location: Entity | Partial<Location>): Entity | null => {
  if (isEntity(location)) {
    return location;
  }

  for (const [id, loc] of world.locations) {
    if (objectHasProperties(loc, location)) {
      return id;
    }
  }
  return null;
}



export type EntityLocation = Component & {
  entity: Entity;
  location: Entity;
}

export const setEntityLocation = (world: World, entity: Entity, location: Entity | Partial<Location>) => {
  const locationId = getLocationE(world, location);
  if (!locationId) {
    return [`Location ${location} not found`];
  }

  const entityLocation: EntityLocation = {
    entity,
    id: 0,
    location: locationId,
  };

  world.entityLocations.set(entity, entityLocation);
  return [null, entityLocation];
}

export type EntityLocationResult = [string, null] | [null, EntityLocation];
export const getEntityLocation = (world: World, entity: Entity): EntityLocationResult => {
  const entityLocation = world.entityLocations.get(entity);
  if (!entityLocation) {
    return [`Entity ${entity} not found`, null];
  }
  return [null, entityLocation];
}


