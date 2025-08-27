import type { Entity } from '@types';
import type { World } from '@/world';
import { setEntityLocation, getEntityLocation, type Location, getLocationE } from './location';

export type Journey = {
  entity: Entity;
  from: Entity;
  state: 'pending' | 'completed' | 'failed';
  to: Entity;
}


export const executeJournies = (world: World) => {
  for (const journey of world.journies) {
    if (journey.state === 'pending') {
      
      setEntityLocation(world, journey.entity, journey.to);
      journey.state = 'completed';
    }
  }
}


type JourneyResult = [string | null, Journey | null];
export const createJourney = (world: World, entity: Entity, to: Partial<Location>): JourneyResult => {

  const [error, entityLocation] = getEntityLocation(world, entity);
  if (error) {
    return [error, null];
  }

  const fromId = entityLocation!.location;
  const toId = getLocationE(world, to);

  if (!toId) {
    return [`Location ${to} not found`, null];
  }

  const journey: Journey = {
    entity,
    from: fromId,
    state: 'pending',
    to: toId,
  };

  world.journies.push(journey);

  return [null, journey];
}