import { createLog } from 'odgn-helpers/log';

import type { ScriptRunner } from '../scripts/runner';
import type { WorldClock } from '../world/clock';
import type { Lifecycle } from '../world/lifecycle';
import type { Places } from '../world/places';
import { createMuaSystem } from './create-mua-system';

const log = createLog('timers');

/**
 * Sends each entity's scheduled messages when they fall due in world time.
 * `reset` resets the place (which tells its Scripts); any other message goes
 * to the entity's Scripts, from the system actor. A timer's first message
 * comes one interval after the world starts.
 */
export const createTimerSystem = (
  clock: WorldClock,
  lifecycle: Lifecycle,
  scripts: ScriptRunner,
  places: Places
) =>
  createMuaSystem(
    ({ entity }) => {
      const now = clock.now();
      const every = (entity.timers.every ?? {}) as Record<string, unknown>;
      const due = { ...((entity.timers.due ?? {}) as Record<string, number>) };
      let changed = false;

      for (const [message, seconds] of Object.entries(every)) {
        if (typeof seconds !== 'number' || seconds <= 0) {
          continue;
        }
        const interval = seconds * 1000;
        const at = due[message];
        if (at === undefined) {
          due[message] = now + interval;
          changed = true;
          continue;
        }
        if (at > now) {
          continue;
        }
        // a long pause fires a timer once, not once per missed interval
        due[message] = Math.max(at + interval, now + 1);
        changed = true;
        log.debug(`${message} due for ${entity.id}`);
        if (message === 'reset') {
          lifecycle.reset(entity.id);
        } else if (scripts.hasScript(entity.id)) {
          scripts.notify(entity.id, message, [{ entity: places.system }]);
        }
      }

      if (changed) {
        entity.timers = { ...entity.timers, due };
      }
    },
    { frequency: 1, priority: 25, with: ['timers'] }
  );
