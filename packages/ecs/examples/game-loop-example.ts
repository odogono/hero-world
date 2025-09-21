/* eslint-disable no-console */

import { defineComponent, s } from '@component';
import { createSystem } from '@system';
import { createGameLoop } from '@system/game-loop';
import { createWorld } from '@world';

// Define game components
const positionComponent = defineComponent({
  id: 'position',
  schema: {
    x: s.number(),
    y: s.number(),
    z: s.number().default(0)
  }
});

const velocityComponent = defineComponent({
  id: 'velocity',
  schema: {
    x: s.number(),
    y: s.number(),
    z: s.number().default(0)
  }
});

const healthComponent = defineComponent({
  id: 'health',
  schema: {
    current: s.number(),
    max: s.number(),
    regenerationRate: s.number().default(0)
  }
});

const playerComponent = defineComponent({
  id: 'player',
  schema: {
    level: s.number().default(1),
    name: s.string()
  }
});

const createTestWorld = async () => {
  const world = await createWorld([
    positionComponent,
    velocityComponent,
    healthComponent,
    playerComponent
  ]);
  return world;
};

// Create world and register components
const world = await createTestWorld();

// Create entities
const player = world.create({
  health: { current: 100, max: 100, regenerationRate: 1 },
  player: { level: 1, name: 'Hero' },
  position: { x: 100, y: 100, z: 0 },
  velocity: { x: 0, y: 0, z: 0 }
});

const enemy1 = world.create({
  health: { current: 50, max: 50, regenerationRate: 0 },
  position: { x: 200, y: 150, z: 0 },
  velocity: { x: -10, y: 0, z: 0 }
});

const enemy2 = world.create({
  health: { current: 75, max: 75, regenerationRate: 0 },
  position: { x: 300, y: 120, z: 0 },
  velocity: { x: -5, y: 5, z: 0 }
});

// Create game systems

// Movement system - updates position based on velocity
const movementSystem = createSystem(
  (entity, world, deltaTime) => {
    const deltaSeconds = deltaTime / 1000;
    entity.position.x += entity.velocity.x * deltaSeconds;
    entity.position.y += entity.velocity.y * deltaSeconds;
    entity.position.z += entity.velocity.z * deltaSeconds;

    // console.log(`Movement system processed ${entities.length} entities`);
  },
  { with: ['position', 'velocity'] }
);

const healthSystem = createSystem(
  (entity, world, deltaTime) => {
    if (
      entity.health.regenerationRate > 0 &&
      entity.health.current < entity.health.max
    ) {
      const deltaSeconds = deltaTime / 1000;
      const regenAmount = entity.health.regenerationRate * deltaSeconds;
      entity.health.current = Math.min(
        entity.health.max,
        entity.health.current + regenAmount
      );
    }
  },
  { with: ['health'] }
);

// Input system - simple example that moves player
const inputState = { down: false, left: false, right: false, up: false };
const inputSystem = createSystem(
  (player, world, deltaTime) => {
    const speed = 100; // pixels per second

    player.velocity.x = 0;
    player.velocity.y = 0;

    if (inputState.left) {
      player.velocity.x -= speed;
    }
    if (inputState.right) {
      player.velocity.x += speed;
    }
    if (inputState.up) {
      player.velocity.y -= speed;
    }
    if (inputState.down) {
      player.velocity.y += speed;
    }
  },
  { with: ['player', 'velocity'] }
);

// Cleanup system - removes entities that are too far from origin
const cleanupSystem = createSystem(
  (entity, world, deltaTime) => {
    const distance = Math.sqrt(entity.position.x ** 2 + entity.position.y ** 2);
    if (distance > 1000) {
      console.log(
        `Entity ${entity.id} is too far away (${distance}), should be cleaned up`
      );
      // In a real game, you'd call deleteEntity(entity) here
    }
  },
  { with: ['position'] }
);

// Debug system - logs game state periodically
let debugTimer = 0;
const debugSystem = createSystem((world, deltaTime) => {
  debugTimer += deltaTime;

  // Log debug info every 2 seconds
  if (debugTimer >= 2000) {
    debugTimer = 0;
    const entities = world.entityCache.size;
    console.log(`=== Game State ===`);
    console.log(`Entities: ${entities}`);
    console.log(
      `Player position: (${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)})`
    );
    console.log(
      `Player health: ${player.health.current.toFixed(1)}/${player.health.max}`
    );
  }
});

// Create and configure game loop
const gameLoop = createGameLoop(world)
  .addSystem('input', inputSystem, { priority: 100 }) // Highest priority
  .addSystem('movement', movementSystem, { priority: 90 })
  .addSystem('health', healthSystem, { priority: 80 })
  .addSystem('cleanup', cleanupSystem, { frequency: 60, priority: 70 }) // Every 60 frames
  .addSystem('debug', debugSystem, { priority: 10 }); // Lowest priority

// Simulate game loop
console.log('Starting game loop simulation...');

// Simulate some input
inputState.right = true;

// Run game loop for a few frames
const targetFPS = 60;
const frameTime = 1000 / targetFPS; // ~16.67ms

for (let frame = 0; frame < 200; frame++) {
  gameLoop.update(frameTime);

  // Change input occasionally
  if (frame === 50) {
    inputState.right = false;
    inputState.up = true;
  }
  if (frame === 100) {
    inputState.up = false;
    inputState.left = true;
  }
  if (frame === 150) {
    inputState.left = false;
  }

  // Simulate frame timing (in real game this would be handled by your game engine)
  // await new Promise(resolve => setTimeout(resolve, frameTime));
}

// Show performance results
console.log('\n=== Performance Report ===');
const performance = gameLoop.getPerformance();
performance.forEach(perf => {
  console.log(
    `${perf.id}: avg ${perf.averageExecutionTime.toFixed(3)}ms, last ${perf.lastExecutionTime.toFixed(3)}ms, count ${perf.executionCount}`
  );
});

// Show final entity states
console.log('\n=== Final Entity States ===');
console.log(
  `Player: pos(${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}), health(${player.health.current.toFixed(1)})`
);
console.log(
  `Enemy1: pos(${enemy1.position.x.toFixed(1)}, ${enemy1.position.y.toFixed(1)}), health(${enemy1.health.current.toFixed(1)})`
);
console.log(
  `Enemy2: pos(${enemy2.position.x.toFixed(1)}, ${enemy2.position.y.toFixed(1)}), health(${enemy2.health.current.toFixed(1)})`
);

export { gameLoop, world };
