import type { Entity, Component } from '@types';
import type { Journey } from '@entity/journey';
import type { Location } from '@entity/location';
import type { EntityLocation } from '@entity/location';
import type { Stats } from '@entity/stats';
import type { HitPoints } from '@entity/stats';


export type World = {
  components: Component[];
  entities: Entity[];
  entityHitPoints: Map<Entity, HitPoints>;
  entityLocations: Map<Entity, EntityLocation>;
  entityStats: Map<Entity, Stats>;
  journies: Journey[];
  locations: Map<Entity, Location>;
}



export const createWorld = (): World => ({
    components: [],
    entities: [],
    entityHitPoints: new Map<Entity, HitPoints>(),
    entityLocations: new Map<Entity, EntityLocation>(),
    entityStats: new Map<Entity, Stats>(),
    journies: [],
    locations: new Map<Entity, Location>(),
  })

