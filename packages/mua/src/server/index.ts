import { Elysia } from 'elysia';
import { createLog } from 'odgn-helpers/log';

const log = createLog('server');

const app = new Elysia()
  .ws('/ws', {
    message(ws, message) {
      log.debug('WebSocket message received:', message);
      // Echo back the received message
      ws.send({ message });
    },
    open(ws) {
      log.info('WebSocket connection opened');
      ws.send({ message: 'Connected to echo server' });
    },
    close(ws) {
      log.info('WebSocket connection closed');
    }
  })
  .get('/', () => 'Elysia WebSocket Echo Server')
  .listen(3000);

log.info(`🦊😎 Elysia is running at http://localhost:${app.server?.port}...`);
