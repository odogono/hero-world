import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';
import { createLog } from 'odgn-helpers/log';

import type { MuaComponents } from '../coms';
import { getEntity } from '../queries/entity';
import type { ScriptRunner } from '../scripts/runner';
import type { Places } from './places';

const log = createLog('lifecycle');

type MuaWorld = World<MuaComponents>;

/**
 * Remembers where each thing starts, as its `home`, so a reset can put it
 * back. Things already given a home keep it; players and exits have none.
 */
export const recordHomes = (world: MuaWorld) => {
  const things = world.queryAll({
    maybe: ['home', 'player', 'portal'],
    with: ['location']
  });
  for (const thing of things) {
    if (thing.home || thing.player || thing.portal) {
      continue;
    }
    const entity = getEntity(world, thing.id, ['location'], true);
    if (entity) {
      Object.assign(entity, { home: { in: thing.location.in } });
    }
  }
  world.flush();
};

/** Is a player holding this, directly or inside something they carry? */
const isCarried = (world: MuaWorld, id: EntityId) => {
  const seen = new Set<EntityId>();
  let holder = getEntity(world, id, ['location'])?.location.in;
  while (holder !== undefined && holder !== null && !seen.has(holder)) {
    if (getEntity(world, holder, ['player'])) {
      return true;
    }
    seen.add(holder);
    holder = getEntity(world, holder, ['location'])?.location.in;
  }
  return false;
};

/** Sends a lifecycle message to an entity's Scripts, from the system actor */
const announce = (
  scripts: ScriptRunner,
  places: Places,
  id: EntityId,
  message: string
) => {
  if (scripts.hasScript(id)) {
    scripts.notify(id, message, [{ entity: places.system }]);
  }
};

export type Lifecycle = {
  /**
   * Puts back every thing whose home is this place and that has wandered,
   * unless a player is carrying it, then sends `reset` to the place's
   * Scripts. Returns how many things moved.
   */
  reset: (placeId: EntityId) => number;
  /** Sends `start` to every scripted entity, once the world is running */
  start: () => void;
};

export const createLifecycle = (
  world: MuaWorld,
  scripts: ScriptRunner,
  places: Places
): Lifecycle => ({
  reset: placeId => {
    const strays = world
      .queryAll({ with: ['home', 'location'] })
      .filter(
        t =>
          t.home.in === placeId &&
          t.location.in !== placeId &&
          !isCarried(world, t.id)
      );
    for (const stray of strays) {
      const thing = getEntity(world, stray.id, ['location'], true);
      if (thing) {
        thing.location = { in: placeId };
      }
    }
    world.flush();
    announce(scripts, places, placeId, 'reset');
    log.info(`Reset ${placeId}: ${strays.length} things returned`);
    return strays.length;
  },
  start: () => {
    const all = world.queryAll({ maybe: ['location'], with: ['described'] });
    for (const entity of all) {
      announce(scripts, places, entity.id, 'start');
    }
  }
});
