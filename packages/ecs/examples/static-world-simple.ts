import { s } from '@component';

// Main function to handle async operations
const main = async () => {
  // Import all needed functions
  const { createEntity, createWorld, defineComponent } = await import('../src');

  // Define simple components (no arrays/objects)
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

  const nameComponent = defineComponent({
    id: 'name',
    schema: {
      first: s.string(),
      last: s.string()
    }
  });

  // Create a static world with all components defined upfront
  const world = await createWorld([
    healthComponent,
    positionComponent,
    nameComponent
  ]);

  console.log(
    'Static world created with component types:',
    world.componentTypes
  );

  // Create an entity without initial components
  const player = world.create();
  console.log('Entity created:', player.id);

  // Property assignment with simple types
  player.health = {
    current: 100,
    max: 100
  };

  player.position = {
    x: 10,
    y: 20
  };

  player.name = {
    first: 'John',
    last: 'Doe'
  };

  console.log('Player health:', player.health);
  console.log('Player position:', player.position);
  console.log('Player name:', player.name);

  // Modify components
  player.health.current = 85;
  player.position.x = 15;
  player.name.first = 'Jane';

  console.log('After modifications:');
  console.log('Player health:', player.health);
  console.log('Player position:', player.position);
  console.log('Player name:', player.name);

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

  console.log('\n=== Static World Simple Demo Complete ===');
  console.log('✅ Static world implementation working with simple types');
};

// Run the demo
try {
  await main();
} catch (error) {
  console.error(error);
}
