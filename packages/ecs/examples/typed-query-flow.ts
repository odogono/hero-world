/* eslint-disable no-console */
import { defineComponent, s } from '@component';
import { createEntity, queryEntity } from '@entity';
import { createWorld } from '@world';

// Minimal end-to-end typed flow: createWorld -> createEntity -> queryEntity
const main = async () => {
  const position = defineComponent({
    id: 'position',
    schema: {
      x: s.number(),
      y: s.number()
    }
  });

  const velocity = defineComponent({
    id: 'velocity',
    schema: {
      dx: s.number(),
      dy: s.number()
    }
  });

  // Pass a const tuple so component IDs are preserved for inference
  const world = await createWorld([position, velocity] as const);

  // Entity is fully typed: entity.position.{x,y} are numbers
  const entity = createEntity(world, { position: { x: 10, y: 20 } });
  console.log('entity.position.x (number):', entity.position.x);

  // Query with type narrowing via `with`: result has required `position`
  const found = queryEntity(world, { with: ['position'] as const });
  if (found) {
    // `position` guaranteed present here
    console.log('found.position.y (number):', found.position.y);
  }

  // Query as a proxy to enable property assignment of components
  const proxied = queryEntity(world, {
    with: ['position'] as const,
    asProxy: true
  });
  if (proxied) {
    // Add a new component by assignment with full type safety
    proxied.velocity = { dx: 1, dy: 2 };
    world.flush();
    console.log('proxied.velocity.dx (number):', proxied.velocity.dx);
  }

  world.close();
};

try {
  await main();
} catch (error) {
  console.error(error);
}
