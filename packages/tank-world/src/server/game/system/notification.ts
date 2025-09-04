import { createEventSystem } from 'odgn-ecs/events';
import { createLog } from 'odgn-helpers/log';

const log = createLog('notification-system');

export const notificationSystem = createEventSystem(
  'srv:*',
  ({ payload, type }) => {
    log.debug(`${type}:`, payload);
  }
);
