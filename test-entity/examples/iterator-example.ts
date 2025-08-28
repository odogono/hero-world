/* eslint-disable no-console */
import z from 'zod';

import { defineComponent } from '@component';
import { createEntity, queryEntitiesIterator } from '@entity';
import { createWorld, flush } from '@world';

// Define a component
const healthComponent = defineComponent({
  name: 'health' as const,
  schema: {
    current: z.number(),
    max: z.number()
  }
});

// Example demonstrating the iterator functionality
export const iteratorExample = () => {
  console.log('=== Query Entities Iterator Example ===\n');

  // Create a world with the health component
  const world = createWorld().registerComponent(healthComponent).build();

  // Create some entities
  createEntity(world, { health: { current: 100, max: 100 } });
  createEntity(world, { health: { current: 75, max: 100 } });
  createEntity(world, { health: { current: 50, max: 100 } });
  createEntity(world, { health: { current: 25, max: 100 } });
  createEntity(world, { health: { current: 0, max: 100 } });

  // Flush to persist to database
  flush(world);

  console.log('1. Iterating over all entities:');
  const allEntities = queryEntitiesIterator(world, { with: ['health'] });
  for (const entity of allEntities) {
    console.log(
      `  Entity ${entity.id}: ${entity.health.current}/${entity.health.max} HP`
    );
  }

  console.log(
    '\n2. Iterating over entities with low health (using WHERE clause):'
  );
  const lowHealthEntities = queryEntitiesIterator(world, {
    where: 'health_current < 50',
    with: ['health']
  });
  for (const entity of lowHealthEntities) {
    console.log(
      `  Entity ${entity.id}: ${entity.health.current}/${entity.health.max} HP (Low health!)`
    );
  }

  console.log('\n3. Iterating with limit (first 2 entities):');
  const limitedEntities = queryEntitiesIterator(world, {
    limit: 2,
    with: ['health']
  });
  for (const entity of limitedEntities) {
    console.log(
      `  Entity ${entity.id}: ${entity.health.current}/${entity.health.max} HP`
    );
  }

  console.log('\n4. Iterating with offset (skip first 2 entities):');
  const offsetEntities = queryEntitiesIterator(world, {
    offset: 2,
    with: ['health']
  });
  for (const entity of offsetEntities) {
    console.log(
      `  Entity ${entity.id}: ${entity.health.current}/${entity.health.max} HP`
    );
  }

  console.log('\n5. Combining limit and offset:');
  const combinedEntities = queryEntitiesIterator(world, {
    limit: 2,
    offset: 1,
    with: ['health']
  });
  for (const entity of combinedEntities) {
    console.log(
      `  Entity ${entity.id}: ${entity.health.current}/${entity.health.max} HP`
    );
  }

  console.log('\n=== Iterator Example Complete ===');
};

// Run the example if this file is executed directly
if (import.meta.main) {
  iteratorExample();
}
