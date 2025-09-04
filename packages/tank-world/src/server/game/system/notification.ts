import { createEventSystem } from 'odgn-ecs/events';
import { createLog } from 'odgn-helpers/log';

const log = createLog('notification-system');

// Callback to broadcast messages to WebSocket clients
let broadcastCallback: ((message: any) => void) | null = null;

export const setBroadcastCallback = (callback: (message: any) => void) => {
  broadcastCallback = callback;
};

export const notificationSystem = createEventSystem(
  ['srv:*', 'tank:*', 'move:*'],
  ({ payload, type }) => {
    log.debug(`${type}:`, payload);
    
    // Broadcast game events to WebSocket clients
    if (broadcastCallback) {
      const gameEvent = {
        type: `game:${type}`,
        payload,
        ts: Date.now()
      };
      broadcastCallback(gameEvent);
    }
  }
);
