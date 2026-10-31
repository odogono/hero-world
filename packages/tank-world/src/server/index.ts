import { Elysia } from 'elysia';
import { createLog } from 'odgn-helpers/log';
import { z } from 'zod';

import {
  ChatSchema,
  ClientMessageSchema,
  WelcomeSchema
} from '../shared/messages';
import {
  createWorld,
  issueMoveOrder,
  spawnTank,
  type TankWorld
} from './game/world';

const log = createLog('server');

const PORT = Number(process.env.PORT || 3001);

// In-memory registry of connected clients
type ClientConn = { send: (data: string) => void } & { _id?: number };
const clients = new Set<ClientConn>();
const wsToId = new WeakMap<object, number>();
let nextPlayerId = 1;

// Game world
const tankWorldPromise = createWorld();
let broadcastTimer: ReturnType<typeof setInterval> | null = null;
let stepTimer: ReturnType<typeof setInterval> | null = null;

// Game world instance
let gameWorld: TankWorld | null = null;

// Schemas (Zod)
const EchoSchema = z.object({
  text: z.string().min(1),
  times: z.number().int().min(1).max(5).default(1)
});

const ChatMessage = z.object({
  name: z.string().min(1).max(32).optional(),
  text: z.string().min(1).max(500),
  type: z.literal('chat').default('chat')
});

// Game message schemas
const GameMoveCommand = z.object({
  tankId: z.number(),
  targetX: z.number(),
  targetY: z.number(),
  type: z.literal('game:move')
});

const GameSpawnCommand = z.object({
  team: z.enum(['red', 'blue']),
  type: z.literal('game:spawn'),
  x: z.number().optional(),
  y: z.number().optional()
});

const GameStateRequest = z.object({
  requestId: z.string(),
  type: z.literal('game:world_state')
});

const GameMessage = z.union([
  GameMoveCommand,
  GameSpawnCommand,
  GameStateRequest
]);

// Game loop management
let gameLoopInterval: Timer | null = null;
const GAME_TICK_RATE = 60; // 60 FPS
const GAME_TICK_INTERVAL = 1000 / GAME_TICK_RATE;

// Initialize game world
const initializeGameWorld = async () => {
  if (gameWorld) {
    return gameWorld;
  }

  log.info('Initializing game world...');
  gameWorld = await createWorld();

  // Connect notification system to WebSocket broadcasting
  setBroadcastCallback(broadcastToClients);

  // Spawn some initial tanks for testing
  spawnTank(gameWorld, 'red', 100, 100);
  spawnTank(gameWorld, 'blue', 300, 300);

  log.info('Game world initialized with sample tanks');
  return gameWorld;
};

// Start game loop
const startGameLoop = () => {
  if (gameLoopInterval || !gameWorld) {
    return;
  }

  log.info(`Starting game loop at ${GAME_TICK_RATE} FPS`);
  gameLoopInterval = setInterval(() => {
    gameWorld!.loop.update(GAME_TICK_INTERVAL);
  }, GAME_TICK_INTERVAL);
};

// Stop game loop
const stopGameLoop = () => {
  if (gameLoopInterval) {
    clearInterval(gameLoopInterval);
    gameLoopInterval = null;
    log.info('Game loop stopped');
  }
};

// Broadcast message to all connected clients
const broadcastToClients = (message: unknown) => {
  const json = JSON.stringify(message);
  for (const client of clients) {
    client.send(json);
  }
};

// Handle game messages from WebSocket
const handleGameMessage = (
  ws: ClientConn,
  message: z.infer<typeof GameMessage>
) => {
  if (!gameWorld) {
    ws.send(
      JSON.stringify({
        message: 'Game world not initialized',
        ts: Date.now(),
        type: 'error'
      })
    );
    return;
  }

  switch (message.type) {
    case 'game:move':
      handleMoveCommand(message.tankId, message.targetX, message.targetY);
      break;
    case 'game:spawn':
      handleSpawnCommand(message.team, message.x, message.y);
      break;
    case 'game:world_state':
      handleWorldStateRequest(ws, message.requestId);
      break;
  }
};

// Handle tank move command
const handleMoveCommand = (
  tankId: number,
  targetX: number,
  targetY: number
) => {
  if (!gameWorld) {
    return;
  }

  log.info(`Moving tank ${tankId} to (${targetX}, ${targetY})`);
  gameWorld.scheduleEvent('cmd:move', { id: tankId, targetX, targetY });
};

// Handle tank spawn command
const handleSpawnCommand = (team: 'red' | 'blue', x?: number, y?: number) => {
  if (!gameWorld) {
    return;
  }

  const spawnX = x ?? Math.random() * 400;
  const spawnY = y ?? Math.random() * 300;

  log.info(`Spawning ${team} tank at (${spawnX}, ${spawnY})`);
  const tank = spawnTank(gameWorld, team, spawnX, spawnY);

  // Broadcast spawn event to all clients
  broadcastToClients({
    tankId: tank.id,
    team,
    ts: Date.now(),
    type: 'game:tank_spawned',
    x: spawnX,
    y: spawnY
  });
};

// Handle world state request
const handleWorldStateRequest = (ws: ClientConn, requestId: string) => {
  if (!gameWorld) {
    return;
  }

  log.info(`Requesting world state with ID: ${requestId}`);
  // Use the ECS event system to query world state
  gameWorld.scheduleEvent('query:world_state', {
    requestId: Number(requestId)
  });
};

const app = new Elysia()
  // Basic health check
  .get('/health', () => ({ status: 'ok' }))
  // HTTP API routes, grouped under /api
  .group('/api', app =>
    app
      .get('/hello', () => ({ message: 'hello from api' }))
      .get('/time', () => ({ now: new Date().toISOString() }))
      .post('/echo', ({ body, set }) => {
        const parsed = EchoSchema.safeParse(body);
        if (!parsed.success) {
          set.status = 400;
          return { error: parsed.error.flatten() };
        }
        const { text, times } = parsed.data;
        return { result: Array(times).fill(text).join(' ') };
      })
  )
  // WebSocket endpoint
  .ws('/ws', {
    close(ws) {
      clients.delete(ws as unknown as ClientConn);
      if (clients.size === 0) {
        stopGameLoops();
      }
    },
    message(ws, message) {
      log.info('WebSocket message received (typeof):', typeof message);
      log.info('WebSocket message received (raw):', message);

      let candidate: unknown;

      // Handle different message types
      if (typeof message === 'string') {
        // String message - try to parse as JSON
        try {
          candidate = JSON.parse(message);
        } catch {
          candidate = { text: message, type: 'chat' };
        }
      } else if (typeof message === 'object' && message !== null) {
        // Already an object - use directly
        candidate = message;
      } else {
        // Other types - convert to string and treat as chat
        const raw = String(message);
        candidate = { text: raw, type: 'chat' };
      }

      log.info('Parsed message:', candidate);

      // Try to parse as game message first
      const gameMessageResult = GameMessage.safeParse(candidate);
      if (gameMessageResult.success) {
        log.info('Valid game message:', gameMessageResult.data);
        handleGameMessage(ws, gameMessageResult.data);
        return;
      }

      const parsed = ClientMessageSchema.safeParse(json);
      if (!parsed.success) {
        ws.send(
          JSON.stringify({
            issues: parsed.error.issues,
            message: 'invalid message',
            type: 'error'
          })
        );
        return;
      }

      const msg = parsed.data;
      switch (msg.type) {
        case 'hello': {
          // No-op beyond welcome; could map name to player later
          break;
        }
        case 'chat': {
          const payload = { ...ChatSchema.parse(msg), ts: Date.now() };
          const data = JSON.stringify(payload);
          for (const client of clients) {
            client.send(data);
          }
          break;
        }
        case 'cmd:spawn': {
          spawnTank(world, msg.team, msg.x, msg.y);
          break;
        }
        case 'cmd:move': {
          issueMoveOrder(world, msg.id, msg.x, msg.y);
          break;
        }
      }
    },
    async open(ws) {
      // Register connection and assign a playerId
      const c = ws as unknown as ClientConn;
      const playerId = nextPlayerId++;
      wsToId.set(ws as unknown as object, playerId);
      c._id = playerId;
      clients.add(c);

      // Send initial welcome
      const welcome = {
        clients: clients.size,
        playerId,
        ts: Date.now(),
        type: 'welcome'
      };
      ws.send(JSON.stringify(welcome satisfies z.infer<typeof WelcomeSchema>));

      // Send an initial world snapshot after world is ready
      const world = await tankWorldPromise;
      const snap = world.snapshot();
      ws.send(JSON.stringify(snap));

      // Start loop/broadcast on first client
      if (clients.size === 1) {
        startGameLoops();
      }
    }
  });

// Initialize game world and start server
const startServer = async () => {
  try {
    await initializeGameWorld();
    startGameLoop();

    app.listen(PORT);

    log.info(`API listening on http://localhost:${PORT}`);
    log.info(`HTTP:  GET  /health, /api/hello, /api/time`);
    log.info(`WS:    ws://localhost:${PORT}/ws`);
    log.info('Game server ready!');
  } catch (error) {
    log.error('Failed to start server:', error);
    process.exit(1);
  }
};

log.info(`API listening on http://localhost:${PORT}`);
log.info(`HTTP:  GET  /health, /api/hello, /api/time`);
log.info(`WS:    ws://localhost:${PORT}/ws`);

// Game loop and broadcaster
const startGameLoops = async () => {
  const world = await tankWorldPromise;
  if (!stepTimer) {
    const stepMs = 16; // ~60 Hz
    stepTimer = setInterval(() => {
      world.update(stepMs);
    }, stepMs);
  }
  if (!broadcastTimer) {
    const rateMs = Number(process.env.BROADCAST_MS || 100); // 10 Hz default
    broadcastTimer = setInterval(() => {
      const snap = world.snapshot();
      const data = JSON.stringify({ ...snap, type: 'world:update' });
      for (const client of clients) {
        client.send(data);
      }
    }, rateMs);
  }
};

const stopGameLoops = () => {
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = null;
  }
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
};

process.on('SIGINT', () => {
  log.info('\nShutting down server...');
  stopGameLoop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('\nShutting down server...');
  stopGameLoop();
  process.exit(0);
});
