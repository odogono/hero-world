import { Elysia } from 'elysia';
import { createLog } from 'odgn-helpers/log';
import { safeParseInt } from 'odgn-helpers/number';

import { cors } from '@elysiajs/cors';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

import { testDataHandler, userProfileHandler } from './handlers/client';
import { oauthHandler } from './handlers/oauth';
import { wsHandler } from './handlers/ws';
import { MuaWorld } from './mua-world';
import { router as orpcRouter } from './orpc/router';
import { authPlugin } from './plugins/auth';

const SERVER_HOST = process.env.HUB_API_HOST || '0.0.0.0';
const SERVER_PORT = safeParseInt(process.env.HUB_API_PORT, 3974);

const log = createLog('server');

interface CreateServerProps {
  enableLogging?: boolean;
}

let muaWorld: MuaWorld | null = null;

export const createServer = async ({
  enableLogging = true
}: CreateServerProps = {}) => {
  const openApiHandler = new OpenAPIHandler(orpcRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        specGenerateOptions: {
          info: {
            title: 'ORPC Playground',
            version: '1.0.0'
          }
        }
      })
    ]
  });

  muaWorld = new MuaWorld();
  muaWorld.open();

  const app = new Elysia().use(
    cors({
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      origin: '*'
    })
      .get('/health', () => ({
        status: 'ok',
        timestamp: new Date().toISOString()
      }))
      .group('/oauth', oauthHandler)
      .all(
        '/api/*',
        async ({ request }: { request: Request }) => {
          const headers: Record<string, string> = {};
          request.headers.forEach((value, key) => {
            headers[key] = value;
          });

          const { response } = await openApiHandler.handle(request, {
            context: {
              headers
            },
            prefix: '/api'
          });

          return response ?? new Response('Not Found', { status: 404 });
        },
        {
          parse: 'none', // Disable Elysia body parser to prevent "body already used" error
          requireAuth: false
        }
      )
      .ws('/ws', wsHandler({ muaWorld }))
      .get('/', () => 'Elysia WebSocket Echo Server')
      .use(authPlugin)
      .get('/test/data', testDataHandler, { requireAuth: true })
      .get('/user', userProfileHandler, { requireAuth: true })
  );

  return app;
};

// Start the server
const start = async () => {
  log.info('Starting server on port', SERVER_PORT);
  try {
    const server = await createServer();

    server.listen(SERVER_PORT);

    log.info(`Server is running on http://${SERVER_HOST}:${SERVER_PORT}`);
  } catch (error) {
    log.error('Failed to start server:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  if (muaWorld) {
    await muaWorld.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (muaWorld) {
    await muaWorld.close();
  }
  process.exit(0);
});

start();
