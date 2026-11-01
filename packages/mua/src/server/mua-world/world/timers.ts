import type { DueTimer, EcsTalk } from 'ecs-talk';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from '../coms';
import { getEntity } from '../queries/entity';
import type { ScriptRunner } from '../scripts/runner';
import type { WorldClock } from './clock';
import type { Lifecycle } from './lifecycle';
import type { Places } from './places';

const log = createLog('timers');

/** The script name mua's own timers are stored under in the timer store */
export const MUA_TIMERS = 'mua:timers';

type MuaWorld = World<MuaComponents>;

/** Seconds between each of an entity's `timers`, by message, if set */
const intervalOf = (world: MuaWorld, owner: number, message: string) => {
  const every = getEntity(world, owner, ['timers'])?.timers.every as
    Record<string, unknown> | undefined;
  const seconds = every?.[message];
  return typeof seconds === 'number' && seconds > 0 ? seconds : undefined;
};

/**
 * The EDL `timers` component, kept in ecs-talk's timer store (the same one
 * Scripts' `tell timer to schedule` uses) under `MUA_TIMERS`:
 * - `arm` stores the first of each entity's timers, one interval from now,
 *   unless one is stored already (as after a restart);
 * - `onTimer` handles them as they fall due: `reset` resets the place (which
 *   tells its Scripts), any other message goes to the entity's Scripts from
 *   the system actor; then it stores the next one.
 */
export const createMuaTimers = (
  world: MuaWorld,
  ecsTalk: EcsTalk<MuaComponents>,
  clock: WorldClock,
  deps: () => { lifecycle: Lifecycle; places: Places; scripts: ScriptRunner }
) => {
  const isStored = (owner: number, name: string) =>
    world
      .queryAll({ with: ['talkTimer'] })
      .some(
        t =>
          t.talkTimer.owner === owner &&
          t.talkTimer.script === MUA_TIMERS &&
          t.talkTimer.name === name
      );

  const store = (owner: number, message: string, at: bigint) =>
    ecsTalk.schedule({
      at,
      message,
      name: message,
      owner,
      script: MUA_TIMERS
    });

  const arm = () => {
    for (const entity of world.queryAll({ with: ['timers'] })) {
      const every = (entity.timers.every ?? {}) as Record<string, unknown>;
      for (const message of Object.keys(every)) {
        const seconds = intervalOf(world, entity.id, message);
        if (seconds !== undefined && !isStored(entity.id, message)) {
          store(entity.id, message, clock.micros() + BigInt(seconds * 1e6));
        }
      }
    }
  };

  const onTimer = (timer: DueTimer) => {
    if (timer.script !== MUA_TIMERS) {
      return false;
    }
    const { lifecycle, places, scripts } = deps();
    log.debug(`${timer.message} due for ${timer.owner}`);
    if (timer.message === 'reset') {
      lifecycle.reset(timer.owner);
    } else if (scripts.hasScript(timer.owner)) {
      scripts.notify(timer.owner, timer.message, [{ entity: places.system }]);
    }
    // the next one; after a long pause, once rather than once per interval
    const seconds = intervalOf(world, timer.owner, timer.message);
    if (seconds !== undefined) {
      const next = timer.at + BigInt(seconds * 1e6);
      const now = clock.micros();
      store(timer.owner, timer.message, next > now ? next : now + 1n);
    }
    return true;
  };

  return { arm, onTimer };
};
