import type { Entity } from '@types';
import type { World } from '@/world';
import { setEntityLocation, getEntityLocation, type Location, getLocationE } from './location';

export type Journey = {
  entity: Entity;
  state: 'pending' | 'completed' | 'failed';
  from: Entity;
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
    from: fromId,
    to: toId,
    entity,
    state: 'pending',
  };

  world.journies.push(journey);

  return [null, journey];
}