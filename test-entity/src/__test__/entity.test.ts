import { describe, it, expect } from 'vitest';


describe('Entity', () => {
  it('should be defined', () => {
    const world = createWorld();
    const hero = createEntity(world);

    createLocation(world, {name: 'home', region: 'city'});
    createLocation(world, {name: 'warehouse', region: 'city'});

    const home = getLocation(world, {name: 'home'});
    expect(home).not.toBeNull();

    setEntityLocation(world, hero, {name: 'home'});
    expect(getLocationByE(world, hero)!.name).toBe('home');
    console.log( getLocationByE(world, hero));

    const [error, transit] = createJourney(world, hero, { name: 'warehouse'});
    expect(error).toBeNull();

    expect(getLocationByE(world, transit!.from)!.name).toBe('home');
    expect(getLocationByE(world, transit!.to)!.name).toBe('warehouse');
    expect( transit!.state ).toBe('pending');

    executeJournies(world);


    expect(getLocationByE(world, hero)!.name).toBe('warehouse');
    
  });
});


type Location = {
  name: string;
  region: string;
}


const createLocation = (world: World, location: Location) => {
  const id = createEntity(world);
  world.locations.set(id, location);
  return id;
}

const getLocationByE = (world: World, id: Entity): Location | null => {
  return world.locations.get(id) ?? null;
}

const getLocation = (world: World,  location: Entity | Partial<Location>): Entity | null => {
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

type EntityLocation = {
  entity: Entity;
  location: Entity;
}

const setEntityLocation = (world: World, entity: Entity, location: Entity | Partial<Location>) => {
  const locationId = getLocation(world, location);
  if (!locationId) {
    return [`Location ${location} not found`];
  }

  const entityLocation: EntityLocation = {
    entity,
    location: locationId,
  };

  world.entityLocations.set(entity, entityLocation);
  return [null, entityLocation];
}

type EntityLocationResult = [string, null] | [null, EntityLocation];
const getEntityLocation = (world: World, entity: Entity): EntityLocationResult => {
  const entityLocation = world.entityLocations.get(entity);
  if (!entityLocation) {
    return [`Entity ${entity} not found`, null];
  }
  return [null, entityLocation];
}


const objectHasProperties = <T extends object>(object: T, properties: Partial<T>) => {
  for (const [key, value] of Object.entries(properties)) {
    if (object[key as keyof T] !== value) {
      return false;
    }
  }
  return true;
}

type Entity = number;

const isEntity = (val: unknown): val is Entity => {
  return typeof val === 'number';
}

type World = {
  entities: Entity[];
  journies: Journey[];
  locations: Map<Entity, Location>;
  entityLocations: Map<Entity, EntityLocation>;
}

const createWorld = (): World => {
  return {
    entities: [],
    journies: [],
    locations: new Map<Entity, Location>(),
    entityLocations: new Map<Entity, EntityLocation>(),
  };
}


export const createEntity = (world: World) => {
  const id = world.entities.length + 1;
  world.entities.push(id);
  return id;
};

type Journey = {
  entity: Entity;
  state: 'pending' | 'completed' | 'failed';
  from: Entity;
  to: Entity;
}


const executeJournies = (world: World) => {
  for (const journey of world.journies) {
    if (journey.state === 'pending') {
      
      setEntityLocation(world, journey.entity, journey.to);
      journey.state = 'completed';
    }
  }
}


type JourneyResult = [string | null, Journey | null];
const createJourney = (world: World, entity: Entity, to: Partial<Location>): JourneyResult => {

  const [error, entityLocation] = getEntityLocation(world, entity);
  if (error) {
    return [error, null];
  }

  const fromId = entityLocation!.location;
  const toId = getLocation(world, to);

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