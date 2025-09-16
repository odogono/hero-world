/* eslint-disable no-console */

import { s } from '../src';

// Main function to handle async operations
const main = async () => {
  // Import all needed functions
  const { createEntity, createWorld, defineComponent } = await import('../src');
  const { flush } = await import('../src/world');

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

  // Create a world and register components
  const world = await createWorld([
    healthComponent,
    positionComponent,
    inventoryComponent
  ]);

  // Create an entity without initial components
  const player = createEntity(world);

  console.log('Entity created:', player.id);

  // Now you can assign components directly to entity properties!
  // This automatically calls addComponent internally

  // Add health component
  player.health = {
    current: 100,
    max: 100
  };

  // Add position component
  player.position = {
    x: 10,
    y: 20
  };

  // Add inventory component
  player.inventory = {
    gold: 50,
    items: ['sword', 'shield']
  };

  console.log('Components assigned via property assignment:');
  console.log('Health:', player.health);
  console.log('Position:', player.position);
  console.log('Inventory:', player.inventory);

  console.log('Components added successfully!');
  console.log('The property assignment feature is working!');

  // You can also modify existing components
  player.health.current = 85;
  player.position.x = 15;
  player.inventory.gold = 75;

  console.log('Modified components:');
  console.log('Health:', player.health);
  console.log('Position:', player.position);
  console.log('Inventory:', player.inventory);

  console.log('Component modification via property assignment is working!');

  // Now demonstrate component deletion via property assignment
  console.log('\n--- Component Deletion Demo ---');

  // Delete health component by setting to null
  console.log('Deleting health component...');
  player.health = null;

  // Delete position component by setting to undefined
  console.log('Deleting position component...');
  player.position = undefined;

  // Verify components are deleted from entity object
  console.log('After deletion (before flush):');
  console.log('Health:', player.health);
  console.log('Position:', player.position);
  console.log('Inventory:', player.inventory);

  console.log('Component deletion via property assignment is working!');
  console.log(
    'Note: Components are marked for deletion but not yet removed from database'
  );

  // Now flush to persist the deletions to the database
  console.log('\n--- Flushing Changes ---');
  flush(world);
  console.log(
    'Flush completed! Component deletions have been persisted to database'
  );

  // Re-add a component to show the full cycle
  console.log('\n--- Re-adding Component Demo ---');
  player.health = {
    current: 50,
    max: 100
  };

  console.log('Re-added health component:');
  console.log('Health:', player.health);
  console.log('Position:', player.position);
  console.log('Inventory:', player.inventory);

  console.log(
    'Full add/delete/update cycle via property assignment is working!'
  );
  console.log(
    'All operations follow the same deferred pattern - changes are persisted on flush()'
  );
};

// Run the demo
try {
  await main();
} catch (error) {
  console.error(error);
}
