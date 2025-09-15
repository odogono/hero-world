import { createLog } from 'odgn-helpers';

import { InferComponentType, defineComponent, s } from '../component';
import { createEntity } from '../entity';
import { isEntity, type Entity, type World } from '../types';

const log = createLog('location');

export const locationComponent = defineComponent({
  id: 'location',
  schema: {
    name: s.string(),
    region: s.string()
  }
});

export type Location = InferComponentType<typeof locationComponent>;

export const createLocation = (world: World<any>, location: Location) => {
  const e = createEntity(world, {
    location
  });

  // world.stmts.locationInsert!.run(e.id, location.name, location.region);

  return e;
};

export const getLocationE = (
  world: World<any>,
  location: Entity | Partial<Location>
): Entity | null => {
  if (isEntity(location)) {
    return location;
  }

  const stmt = world.stmts.locationSelectByName;

  if (!stmt) {
    throw new Error('locationSelectByName not found');
  }

  const result = stmt.get(location.name);

  if (!result) {
    return null;
  }

  return result as Entity;
};
