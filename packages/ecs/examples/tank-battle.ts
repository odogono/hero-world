import { defineComponent, s } from '@component';
import { createEventSystem, eventComponent } from '@events';
import { createGameLoop, createSystem, createWorldSystem } from '@system';
import { createWorld } from '@world';

// ============================================================================
// Component Definitions
// ============================================================================

const positionComponent = defineComponent({
  id: 'position',
  schema: {
    x: s.number(),
    y: s.number()
  }
});

const velocityComponent = defineComponent({
  id: 'velocity',
  schema: {
    x: s.number(),
    y: s.number()
  }
});

const tankComponent = defineComponent({
  id: 'tank',
  schema: {
    health: s.number().default(100),
    id: s.string(), // Unique tank identifier
    maxHealth: s.number().default(100),
    speed: s.number().default(50), // units per second
    team: s.enum(['red', 'blue'])
  }
});

const moveOrderComponent = defineComponent({
  id: 'move_order',
  schema: {
    completed: s.boolean().default(false),
    timestamp: s.number(), // timestamp when order was issued
    xCoord: s.number(),
    yCoord: s.number()
  }
});

// ============================================================================
// Event Types
// ============================================================================

type TankGameEvents = {
  // Commands from clients
  'command:move_tank': { tankId: string; targetX: number; targetY: number };
  'query:world_state': { requestId: string };

  // Server events
  'server:tank_spawned': {
    tankId: string;
    team: 'red' | 'blue';
    x: number;
    y: number;
  };
  'tank:health_changed': { health: number; maxHealth: number; tankId: string };
  'tank:movement_completed': { tankId: string; x: number; y: number };

  // Notifications to clients
  'tank:movement_started': {
    fromX: number;
    fromY: number;
    tankId: string;
    toX: number;
    toY: number;
  };

  // World state responses
  'world_state:response': {
    requestId: string;
    tanks: Array<{
      hasActiveOrder: boolean;
      health: number;
      id: string;
      maxHealth: number;
      team: 'red' | 'blue';
      velocityX: number;
      velocityY: number;
      x: number;
      y: number;
    }>;
  };
};

// ============================================================================
// World Setup
// ============================================================================

const world = await createWorld([
  positionComponent,
  velocityComponent,
  tankComponent,
  moveOrderComponent,
  eventComponent
]);

const eventSystem = createEventSystem(world);

// ============================================================================
// Tank Management Functions
// ============================================================================

const spawnTank = (
  tankId: string,
  team: 'red' | 'blue',
  x: number,
  y: number
) => {
  const tank = world.create({
    position: { x, y },
    tank: {
      health: 100,
      id: tankId,
      maxHealth: 100,
      speed: 50,
      team
    },
    velocity: { x: 0, y: 0 }
  });

  eventSystem.scheduleEvent('notification', 'server:tank_spawned', {
    tankId,
    team,
    x,
    y
  });
  return tank;
};

const issueMoveOrder = (tankId: string, targetX: number, targetY: number) => {
  // Find tank by ID
  const tanks = world.queryAll({
    args: [tankId],
    where: 'tank.tank_id = ?1',
    with: ['tank', 'position', 'velocity']
  });
  const tank = tanks.find(t => t.tank.id === tankId);

  if (!tank) {
    console.warn(`Tank ${tankId} not found`);
    return false;
  }

  // Remove existing move order if present
  const existingOrders = world.queryAll({ with: ['move_order'] });
  const existingOrder = existingOrders.find(
    e => e.id === tank.id && world.entityCache.get(e.id)?.move_order
  );

  // a removed order's cache entry has no data until the next flush
  const orderData = existingOrder
    ? world.entityCache.get(existingOrder.id)?.move_order?.data
    : undefined;
  if (orderData) {
    // Update existing order
    orderData.xCoord = targetX;
    orderData.yCoord = targetY;
    orderData.timestamp = Date.now();
    orderData.completed = false;
  } else {
    // Add new move order component to the tank entity
    const cache = world.entityCache.get(tank.id);
    if (cache) {
      cache.move_order = {
        data: {
          completed: false,
          timestamp: Date.now(),
          xCoord: targetX,
          yCoord: targetY
        },
        exists: true
      };
      // Mark as dirty
      if (!world.dirtyEntities.has(tank.id)) {
        world.dirtyEntities.set(tank.id, new Set());
      }
      world.dirtyEntities.get(tank.id)!.add('move_order');
    }
  }

  // Emit movement started event
  eventSystem.scheduleEvent('notification', 'tank:movement_started', {
    fromX: tank.position.x,
    fromY: tank.position.y,
    tankId,
    toX: targetX,
    toY: targetY
  });

  return true;
};

const handleWorldStateQuery = (requestId: string) => {
  const tanks = world.queryAll({
    with: ['tank', 'position', 'velocity']
  });

  const tankStates = tanks.map(tank => {
    const cache = world.entityCache.get(tank.id);
    const hasActiveOrder =
      cache?.move_order?.data && !cache.move_order.data.completed;

    return {
      hasActiveOrder: !!hasActiveOrder,
      health: tank.tank.health,
      id: tank.tank.id,
      maxHealth: tank.tank.maxHealth,
      team: tank.tank.team,
      velocityX: tank.velocity.x,
      velocityY: tank.velocity.y,
      x: tank.position.x,
      y: tank.position.y
    };
  });

  eventSystem.scheduleEvent('notification', 'world_state:response', {
    requestId,
    tanks: tankStates
  });
};

// ============================================================================
// Game Systems
// ============================================================================

// Movement System - handles tank movement based on move orders
const movementSystem = createSystem(
  (tank, world, deltaTime, events) => {
    const deltaSeconds = deltaTime / 1000;

    // Check if this tank has a move order
    const cache = world.entityCache.get(tank.id);
    const moveOrder = cache?.move_order?.data;

    if (!moveOrder || moveOrder.completed) {
      // No active move order, stop the tank
      tank.velocity.x = 0;
      tank.velocity.y = 0;
      return;
    }

    // Calculate vector to target
    const dx = moveOrder.xCoord - tank.position.x;
    const dy = moveOrder.yCoord - tank.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If close enough to target, complete the order
    if (distance < 2) {
      tank.position.x = moveOrder.xCoord;
      tank.position.y = moveOrder.yCoord;
      tank.velocity.x = 0;
      tank.velocity.y = 0;
      moveOrder.completed = true;

      // Emit completion event
      eventSystem.scheduleEvent('notification', 'tank:movement_completed', {
        tankId: tank.tank.id,
        x: tank.position.x,
        y: tank.position.y
      });

      console.log(
        `Tank ${tank.tank.id} reached target (${tank.position.x.toFixed(1)}, ${tank.position.y.toFixed(1)})`
      );
      return;
    }

    // Calculate velocity vector
    const normalizedDx = dx / distance;
    const normalizedDy = dy / distance;

    tank.velocity.x = normalizedDx * tank.tank.speed;
    tank.velocity.y = normalizedDy * tank.tank.speed;

    // Update position
    tank.position.x += tank.velocity.x * deltaSeconds;
    tank.position.y += tank.velocity.y * deltaSeconds;
  },
  { with: ['position', 'velocity', 'tank'] }
);

// Command System - processes incoming commands
const commandSystem = createWorldSystem<typeof world>(
  (world, deltaTime, events) => {
    // Process incoming command events
    events.forEach(event => {
      switch (event.type) {
        case 'command:move_tank': {
          const moveCmd = event.payload as {
            tankId: string;
            targetX: number;
            targetY: number;
          };
          issueMoveOrder(moveCmd.tankId, moveCmd.targetX, moveCmd.targetY);
          break;
        }
        case 'query:world_state': {
          const query = event.payload as { requestId: string };
          handleWorldStateQuery(query.requestId);
          break;
        }
      }
    });
  }
);

type TankState = {
  hasActiveOrder: boolean;
  id: string;
  team: string;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
};

// Notification System - handles outgoing notifications
const notificationSystem = createWorldSystem<typeof world>(
  (world, deltaTime, events) => {
    // This system handles notification events that need to be sent to clients
    // In a real implementation, this would send events to connected clients
    events.forEach(event => {
      console.log(`[NOTIFICATION] ${event.type}:`, event.payload);
    });
  }
);

// ============================================================================
// Game Loop Setup
// ============================================================================

const gameLoop = createGameLoop(world, eventSystem)
  .addSystem('command', commandSystem, { priority: 100 })
  .addSystem('movement', movementSystem, { priority: 90 })
  .addSystem('notification', notificationSystem, { priority: 10 });

// ============================================================================
// Tank Battle Server API
// ============================================================================

export class TankBattleServer {
  private running = false;
  private lastFrameTime = Date.now();

  constructor() {
    // Spawn some initial tanks
    spawnTank('red-1', 'red', 50, 100);
    spawnTank('red-2', 'red', 75, 150);
    spawnTank('blue-1', 'blue', 450, 100);
    spawnTank('blue-2', 'blue', 425, 150);
  }

  // Command API for clients
  moveTaskTo(tankId: string, x: number, y: number): boolean {
    eventSystem.scheduleEvent('command', 'command:move_tank', {
      tankId,
      targetX: x,
      targetY: y
    });
    return true;
  }

  getWorldState(): Promise<{ tanks: Array<TankState> }> {
    return new Promise(resolve => {
      const requestId = `req_${Date.now()}_${Math.random()}`;

      // Set up a one-time listener for the response
      const checkForResponse = () => {
        const responses = eventSystem.getEventsByType('world_state:response');
        const matchingResponse = responses.find(e => {
          try {
            const payload = JSON.parse(e.event.payload);
            return payload.requestId === requestId;
          } catch {
            return false;
          }
        });

        if (matchingResponse) {
          const payload = JSON.parse(matchingResponse.event.payload);
          resolve({ tanks: payload.tanks });
        } else {
          setTimeout(checkForResponse, 10); // Check again soon
        }
      };

      // Schedule the query
      eventSystem.scheduleEvent('command', 'query:world_state', { requestId });

      // Start checking for response
      setTimeout(checkForResponse, 10);
    });
  }

  // Server management
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.lastFrameTime = Date.now();

    console.log('Tank Battle Server started');

    // Simple game loop simulation
    const gameFrame = () => {
      if (!this.running) {
        return;
      }

      const currentTime = Date.now();
      const deltaTime = currentTime - this.lastFrameTime;
      this.lastFrameTime = currentTime;

      gameLoop.update(deltaTime);

      // Continue loop
      setTimeout(gameFrame, 16); // ~60 FPS
    };

    gameFrame();
  }

  stop() {
    this.running = false;
    console.log('Tank Battle Server stopped');
  }

  // Event system access for external integration
  on<K extends keyof TankGameEvents>(
    eventType: K,
    handler: (event: TankGameEvents[K]) => void
  ) {
    // In the new system, we'd need to poll for events or use a different pattern
    // For now, return a simple unsubscribe function
    const intervalId = setInterval(() => {
      const events = eventSystem.getEventsByType(eventType);
      events.forEach(e => {
        try {
          const payload = JSON.parse(e.event.payload);
          handler(payload);
        } catch {
          // Ignore parse errors
        }
      });
    }, 50);

    return () => clearInterval(intervalId);
  }

  off(unsubscribeFn: () => void) {
    unsubscribeFn();
  }
}

// ============================================================================
// Demo Usage
// ============================================================================

export const runTankBattleDemo = () => {
  const server = new TankBattleServer();

  // Set up event listeners for client notifications
  server.on('tank:movement_started', event => {
    console.log(
      `🚀 Tank ${event.tankId} started moving from (${event.fromX.toFixed(1)}, ${event.fromY.toFixed(1)}) to (${event.toX.toFixed(1)}, ${event.toY.toFixed(1)})`
    );
  });

  server.on('tank:movement_completed', event => {
    console.log(
      `✅ Tank ${event.tankId} reached destination (${event.x.toFixed(1)}, ${event.y.toFixed(1)})`
    );
  });

  server.start();

  // Simulate client commands
  setTimeout(async () => {
    console.log('\n--- Initial World State ---');
    const state = await server.getWorldState();
    state.tanks.forEach(tank => {
      console.log(
        `${tank.id} (${tank.team}): pos(${tank.x.toFixed(1)}, ${tank.y.toFixed(1)}) vel(${tank.velocityX.toFixed(1)}, ${tank.velocityY.toFixed(1)})`
      );
    });

    console.log('\n--- Issuing Commands ---');
    server.moveTaskTo('red-1', 200, 200);
    server.moveTaskTo('blue-1', 300, 150);
  }, 100);

  // Check state after movement
  setTimeout(async () => {
    console.log('\n--- World State After Movement ---');
    const state = await server.getWorldState();
    state.tanks.forEach(tank => {
      console.log(
        `${tank.id} (${tank.team}): pos(${tank.x.toFixed(1)}, ${tank.y.toFixed(1)}) vel(${tank.velocityX.toFixed(1)}, ${tank.velocityY.toFixed(1)}) active_order: ${tank.hasActiveOrder}`
      );
    });
  }, 5000);

  // Stop after demo
  setTimeout(() => {
    server.stop();
  }, 8000);

  return server;
};
