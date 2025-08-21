import type { Entity, Component } from '@types';
import type { Journey } from '@entity/journey';
import type { Location } from '@entity/location';
import type { EntityLocation } from '@entity/location';
import type { Stats } from '@entity/stats';
import type { HitPoints } from '@entity/stats';


export type World = {
  entities: Entity[];
  components: Component[];
  journies: Journey[];
  locations: Map<Entity, Location>;
  entityLocations: Map<Entity, EntityLocation>;
  entityStats: Map<Entity, Stats>;
  entityHitPoints: Map<Entity, HitPoints>;
}



export const createWorld = (): World => {
  return {
    entities: [],
    components: [],
    journies: [],
    locations: new Map<Entity, Location>(),
    entityLocations: new Map<Entity, EntityLocation>(),
    entityStats: new Map<Entity, Stats>(),
    entityHitPoints: new Map<Entity, HitPoints>(),
  };
}

