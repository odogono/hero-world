import { test, expect } from 'bun:test';

import { createWorld } from '@/world';
import { createEntity, getEComponents } from '@entity';
import { setEntityStats } from '@entity/stats';
import { setEntityHitPoints } from '@entity/stats';
import { createLocation } from '@entity/location';
import { getLocationE } from '@entity/location';
import { setEntityLocation } from '@entity/location';

import { getLocationByE } from '@entity/location';
import { getLocation } from '@entity/location';
import { executeJournies } from '@entity/journey';
import { createJourney } from '@entity/journey';


test('Entity should be defined', () => {
  const world = createWorld();
  const hero = createEntity(world);

  setEntityStats(world, hero, {charisma: 10, constitution: 10, dexterity: 10, intelligence: 10, strength: 10, wisdom: 10});
  setEntityHitPoints(world, hero, {current: 10, max: 10});

  

  createLocation(world, {name: 'home', region: 'city'});
  createLocation(world, {name: 'warehouse', region: 'city'});

  const home = getLocationE(world, {name: 'home'});
  expect(home).not.toBeNull();

  setEntityLocation(world, hero, {name: 'home'});
  expect(getLocationByE(world, hero)!.name).toBe('home');

  const [error, transit] = createJourney(world, hero, { name: 'warehouse'});
  expect(error).toBeNull();

  expect(getLocation(world,transit!.from)!.name).toBe('home');
  expect(getLocation(world,transit!.to)!.name).toBe('warehouse');
  expect( transit!.state ).toBe('pending');

  executeJournies(world);

  expect(getLocationByE(world, hero)!.name).toBe('warehouse');

  const components = getEComponents(world, hero);
  // console.log(components);
  
});


type Hero = {
  name: string;
}



