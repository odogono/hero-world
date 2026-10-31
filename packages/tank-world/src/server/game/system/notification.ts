import { createEventSystem } from 'odgn-ecs/events';
import { createLog } from 'odgn-helpers/log';

const log = createLog('notification-system');

// Callback to broadcast messages to WebSocket clients
let broadcastCallback: ((message: unknown) => void) | null = null;

export const setBroadcastCallback = (callback: (message: unknown) => void) => {
  broadcastCallback = callback;
};

export const notificationSystem = createEventSystem(
  ['srv:*', 'tank:*', 'move:*'],
  ({ payload, type }) => {
    log.debug(`${type}:`, payload);

    // Broadcast game events to WebSocket clients
    if (broadcastCallback) {
      const gameEvent = {
        payload,
        ts: Date.now(),
        type: `game:${type}`
      };
      broadcastCallback(gameEvent);
    }
  }
);
