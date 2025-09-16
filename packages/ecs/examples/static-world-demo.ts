/* eslint-disable no-console */

import { s } from '../src';

// Main function to handle async operations
const main = async () => {
  // Import all needed functions
  const { createEntity, createWorld, defineComponent } = await import('../src');

  // Define some components
  const healthComponent = defineComponent({
    id: 'health',
    schema: {
      current: s.number(),
      max: s.number()
    }
  });

  const positionComponent = defineComponent({
    id: 'position',
    schema: {
      x: s.number(),
      y: s.number()
    }
  });

  const inventoryComponent = defineComponent({
    id: 'inventory',
    schema: {
      gold: s.number(),
      items: s.array('string')
    }
  });

  // Create a static world with all components defined upfront
  // Note: Types are automatically inferred from the component definitions!
  const world = await createWorld([
    healthComponent,
    positionComponent,
    inventoryComponent
  ]);

  console.log(
    'Static world created with component types:',
    world.componentTypes
  );

  // Create an entity without initial components
  const player = createEntity(world);
  console.log('Entity created:', player.id);

  // Property assignment still works exactly the same!
  player.health = {
    current: 100,
    max: 100
  };

  player.position = {
    x: 10,
    y: 20
  };

  player.inventory = {
    gold: 50,
    items: ['sword', 'potion']
  };

  console.log('Player health:', player.health);
  console.log('Player position:', player.position);
  console.log('Player inventory:', player.inventory);

  // Modify components
  player.health.current = 85;
  player.position.x = 15;
  player.inventory.gold = 75;

  console.log('After modifications:');
  console.log('Player health:', player.health);
  console.log('Player position:', player.position);
  console.log('Player inventory:', player.inventory);

  // Persist changes
  world.flush();
  console.log('Changes flushed to database');

  // Remove components
  player.health = undefined;
  console.log('Health component removed');

  // Flush deletions
  world.flush();
  console.log('Component deletion flushed');

  // Close the world
  world.close();
  console.log('World closed');

  console.log('\n=== Static World Demo Complete ===');
  console.log('Key benefits of static world:');
  console.log('1. All component types known at compile time');
  console.log('2. Better TypeScript inference and autocomplete');
  console.log('3. No runtime component registration');
  console.log('4. Single transaction setup for better performance');
  console.log('5. Simpler type system without builder pattern complexity');
};

// Run the demo
try {
  await main();
} catch (error) {
  console.error(error);
}
