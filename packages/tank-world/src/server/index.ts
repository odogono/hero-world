import { Elysia } from 'elysia';
import { z } from 'zod';

import {
  ChatSchema,
  ClientMessageSchema,
  WelcomeSchema
} from '../shared/messages';
import { createWorld, issueMoveOrder, spawnTank } from './game/world';

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
    async message(ws, message) {
      const world = await tankWorldPromise;
      const raw = typeof message === 'string' ? message : String(message);

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        // allow plain chat text as a convenience
        json = { text: raw, type: 'chat' };
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

app.listen(PORT);

console.log(`API listening on http://localhost:${PORT}`);
console.log(`HTTP:  GET  /health, /api/hello, /api/time`);
console.log(`WS:    ws://localhost:${PORT}/ws`);

// Game loop and broadcaster
async function startGameLoops() {
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
}

function stopGameLoops() {
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = null;
  }
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
}
