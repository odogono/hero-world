import { Elysia } from 'elysia';
import { z } from 'zod';

const PORT = Number(process.env.PORT || 3001);

// In-memory set of connected WS clients
const clients = new Set<{ send: (data: string) => void }>();

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
      clients.delete(ws as unknown as { send: (data: string) => void });
    },
    message(ws, message) {
      const raw = typeof message === 'string' ? message : String(message);

      // Accept raw text as shorthand for a chat message
      const candidate = (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return { text: raw, type: 'chat' };
        }
      })();

      const parsed = ChatMessage.safeParse(candidate);
      if (!parsed.success) {
        ws.send(
          JSON.stringify({
            issues: parsed.error.issues,
            message: 'invalid chat message',
            type: 'error'
          })
        );
        return;
      }

      const payload = {
        ...parsed.data,
        ts: Date.now()
      };

      // Broadcast to all connected clients
      const json = JSON.stringify(payload);
      for (const client of clients) {
        client.send(json);
      }
    },
    open(ws) {
      clients.add(ws as unknown as { send: (data: string) => void });
      ws.send(
        JSON.stringify({
          clients: clients.size,
          ts: Date.now(),
          type: 'welcome'
        })
      );
    }
  });

app.listen(PORT);

console.log(`API listening on http://localhost:${PORT}`);
console.log(`HTTP:  GET  /health, /api/hello, /api/time`);
console.log(`WS:    ws://localhost:${PORT}/ws`);
