/* eslint-disable no-console */
import z from 'zod';

import { defineComponent } from '@component';
import { createEntity, queryEntities } from '@entity';
import { createWorld, flush } from '@world';

// Define some example components
const healthComponent = defineComponent({
  name: 'health' as const,
  schema: {
    current: z.number(),
    max: z.number()
  }
});

const inventoryComponent = defineComponent({
  name: 'inventory' as const,
  schema: {
    capacity: z.number(),
    itemCount: z.number()
  }
});

const playerComponent = defineComponent({
  name: 'player' as const,
  schema: {
    level: z.number(),
    name: z.string()
  }
});

export const notHasQueryExample = () => {
  console.log('=== Not Has Query Example ===\n');

  // Create a world with all our components
  const world = createWorld()
    .registerComponent(healthComponent)
    .registerComponent(inventoryComponent)
    .registerComponent(playerComponent)
    .build();

  // Create various entities with different component combinations
  const player1 = createEntity(world, {
    health: { current: 100, max: 100 },
    inventory: { capacity: 10, itemCount: 2 },
    player: { level: 5, name: 'Alice' }
  });

  const player2 = createEntity(world, {
    health: { current: 80, max: 100 },
    player: { level: 3, name: 'Bob' }
    // No inventory component
  });

  const npc1 = createEntity(world, {
    health: { current: 50, max: 50 }
    // No player or inventory components
  });

  const npc2 = createEntity(world, {
    inventory: { capacity: 5, itemCount: 1 }
    // No player or health components
  });

  const item = createEntity(world, {
    inventory: { capacity: 1, itemCount: 1 }
    // No player or health components
  });

  flush(world);

  console.log('Created entities:');
  console.log('- Player 1: has player, health, inventory');
  console.log('- Player 2: has player, health (no inventory)');
  console.log('- NPC 1: has health only');
  console.log('- NPC 2: has inventory only');
  console.log('- Item: has inventory only\n');

  // Query examples using with and without

  // 1. Find all players without inventory
  const playersWithoutInventory = queryEntities(world, {
    with: ['player', 'health'],
    without: ['inventory']
  });
  console.log('Players without inventory:', playersWithoutInventory.length);
  playersWithoutInventory.forEach(entity => {
    console.log(`  - ${entity.player.name} (level ${entity.player.level})`);
  });

  // 2. Find all entities with health but no player component (NPCs)
  const npcsWithHealth = queryEntities(world, {
    with: ['health'],
    without: ['player']
  });
  console.log('\nNPCs with health:', npcsWithHealth.length);
  npcsWithHealth.forEach(entity => {
    console.log(`  - Health: ${entity.health.current}/${entity.health.max}`);
  });

  // 3. Find all entities with inventory but no player component (items/containers)
  const nonPlayerInventory = queryEntities(world, {
    with: ['inventory'],
    without: ['player']
  });
  console.log(
    '\nNon-player entities with inventory:',
    nonPlayerInventory.length
  );
  nonPlayerInventory.forEach(entity => {
    console.log(
      `  - Item count: ${entity.inventory.item_count} (capacity: ${entity.inventory.capacity})`
    );
  });

  // 4. Find all entities with health but no inventory (simple NPCs)
  const simpleNpcs = queryEntities(world, {
    with: ['health'],
    without: ['player', 'inventory']
  });
  console.log('\nSimple NPCs (health only):', simpleNpcs.length);
  simpleNpcs.forEach(entity => {
    console.log(`  - Health: ${entity.health.current}/${entity.health.max}`);
  });

  // 5. Combine without with other query options
  const limitedResults = queryEntities(world, {
    limit: 1,
    with: ['health'],
    without: ['player']
  });
  console.log(
    '\nLimited results (first NPC with health):',
    limitedResults.length
  );
  if (limitedResults.length > 0) {
    console.log(
      `  - Health: ${limitedResults[0]!.health.current}/${limitedResults[0]!.health.max}`
    );
  }

  // 6. Use with option to specify which components to include
  const playerWithHealthOnly = queryEntities(world, {
    with: ['player', 'health'],
    without: ['inventory']
  });
  console.log(
    '\nPlayers with health only (using with option):',
    playerWithHealthOnly.length
  );
  playerWithHealthOnly.forEach(entity => {
    console.log(
      `  - ${entity.player.name} (level ${entity.player.level}) - Health: ${entity.health.current}/${entity.health.max}`
    );
  });

  console.log('\n=== Example Complete ===');
};

// Run the example if this file is executed directly
if (import.meta.main) {
  notHasQueryExample();
}
