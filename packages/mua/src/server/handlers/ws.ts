// Note: Do not import Bun's WebSocketHandler types here; Elysia's .ws expects its own hook shape
import { createLog } from 'odgn-helpers/log';
import { trycatch } from 'odgn-helpers/try-catch';
import { z } from 'zod';

import type { MuaConnection, MuaWorld } from '../mua-world';

const log = createLog('ws-handler');

// Example schemas
// const messageSchema = z.object({
//   type: z.enum(['ping', 'chat', 'join']),
//   payload: z.union([
//     z.string(), // for chat
//     z.object({ room: z.string() }), // for join
//     z.null() // for ping
//   ])
// });

type WsHandlerOptions = {
  muaWorld: MuaWorld;
};

const messageSchema = z.union([
  z.object({
    type: z.literal('ping')
  }),
  z.object({
    type: z.literal('chat'),
    payload: z.string()
  }),
  z.object({
    type: z.literal('join'),
    payload: z.object({ room: z.string() })
  }),
  z.object({
    type: z.literal('cmd'),
    payload: z.any()
  })
]);

const responseSchema = z.object({
  success: z.boolean(),
  data: z.any()
});

export const wsHandler = ({ muaWorld }: WsHandlerOptions) => {
  const getWsId = (ws: any) => ws?.raw?.id ?? ws?.id ?? 'unknown';
  return {
    message(ws: any, message: unknown) {
      // try {

      // Parse incoming message with Zod
      const { data, success, error } = messageSchema.safeParse(message);

      if (!success) {
        const { issues } = error;
        const issue = issues[0];
        // log.debug('error', issues);
        ws.send(JSON.stringify({ success: false, data: issue?.message }));
        return;
      }

      // Handle by type
      switch (data.type) {
        case 'ping':
          ws.send(
            JSON.stringify(
              responseSchema.parse({ success: true, data: 'pong' })
            )
          );
          break;

        case 'chat':
          ws.send(
            JSON.stringify(
              responseSchema.parse({
                success: true,
                data: `You said: ${data.payload}`
              })
            )
          );
          break;

        case 'join':
          ws.send(
            JSON.stringify(
              responseSchema.parse({
                success: true,
                data: `Joined room: ${data.payload.room}`
              })
            )
          );
          break;

        case 'cmd':
          muaWorld.onConnectionCommand(
            ws as unknown as MuaConnection,
            data.payload
          );
          break;
      }
    },
    open(ws: any) {
      log.info('[open] WebSocket connection opened', getWsId(ws));

      const result = trycatch(() => {
        ws.send(
          JSON.stringify({
            success: true,
            data: 'Welcome to MUA! Please enter your username:'
          })
        );

        const result = muaWorld.onConnectionOpened(
          ws as unknown as MuaConnection
        );
      });

      // log.debug('[open]', result);
    },
    close(ws: any) {
      const result = muaWorld.onConnectionClosed(
        ws as unknown as MuaConnection
      );

      // log.info('WebSocket connection closed', ws.id);
    }
  };
};
