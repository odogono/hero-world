import { test } from 'bun:test';
import { createWorld, flush, saveWorld } from '../world';
import * as z from 'zod';
import { createLog } from '@helpers/log';
import { createEntity, queryEntities } from '../entity';
import { defineComponent } from '../component';


const log = createLog('test-main');



test('SQLite should be able to create a database', async () => {
  const locationComponent = defineComponent({
    name: 'locationScene' as const,
    schema: {
      name: z.string(),
      region: z.string(),
    },
  });

  const world = createWorld()
    .registerComponent(locationComponent)
    .build();

  // const e = createEntity(world);
  // console.log(e.id);

  
  const e = createEntity(world, {locationScene: {name: 'home', region: 'city'}});

  // addComponent(e, 'location', {name: 'home', region: 'city'});

  e.locationScene.name = 'work';

  // log.debug('entity', e);
  // log.debug('world', world);

  flush(world);


  const entities = queryEntities(world, ['locationScene']);
  log.debug('entities', entities);

  // deleteEntity(e);
  // expect(getEntity(world, e.id)).toBeNull();

  // log.debug('e', e);

  // createLocation(world, {name: 'home', region: 'city'});
  // createLocation(world, {name: 'warehouse', region: 'city'});

  // const home = getLocationE(world, {name: 'home'});
  // expect(home).not.toBeNull();

  // log.info('home', home);

  // const office = getLocationE(world, {name: 'office'});
  // expect(office).toBeNull();

  // // backup
  saveWorld(world, './world.db');

});



