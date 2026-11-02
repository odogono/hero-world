import { migrateEDL, type MigrationPlan } from 'odgn-ecs/edl';
import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { findRoomByMetaId } from '../queries/room';
import { expandExits } from './exits';
import { LIMBO_META_ID } from './places';
import { MUA_TIMERS } from './timers';

type MuaWorld = World<MuaComponents>;

export type WorldMigration = {
  /** Rooms whose exit entities were made again from their `exits` */
  exitsRemade: EntityId[];
  plan: MigrationPlan;
  /** mua timers cancelled because nothing declares them any more */
  timersCancelled: { message: string; owner: EntityId }[];
};

export type MigrateWorldOptions = {
  /** Path of the .edl file; `script.src` values resolve relative to it */
  path?: string;
  /** Move entities gone from the EDL to Limbo */
  prune?: boolean;
};

/** Whether a migration changed a component of an entity */
const touched = (plan: MigrationPlan, component: string) =>
  plan.updated
    .filter(
      ({ added, changed, removed }) =>
        added.includes(component) ||
        changed.includes(component) ||
        removed.includes(component)
    )
    .map(({ eid }) => eid);

/**
 * Deletes the exit entities made from a room's `exits` (its own, and the
 * ways back that lead to it), so `expandExits` makes them as they are now.
 * Exits declared as entities in the EDL have Definition names and stay.
 */
const removeMadeExits = (world: MuaWorld, rooms: EntityId[]) => {
  const named = new Set(world.getDefinitionNames().values());
  const roomSet = new Set(rooms);
  const exits = world.queryAll({ with: ['portal', 'location'] });
  for (const exit of exits) {
    if (named.has(exit.id)) {
      continue;
    }
    const { to } = exit.portal;
    const at = exit.location.in;
    if ((at != null && roomSet.has(at)) || (to != null && roomSet.has(to))) {
      world.delete(exit);
    }
  }
  world.flush();
};

/** mua timers whose entity is gone, or whose `timers` no longer declares them */
const removeStaleTimers = (world: MuaWorld) => {
  const cancelled: WorldMigration['timersCancelled'] = [];
  for (const timer of world.queryAll({ with: ['talkTimer'] })) {
    const { name, owner, script } = timer.talkTimer;
    if (script !== MUA_TIMERS || owner == null) {
      continue;
    }
    const every = world.query({
      entity: { id: owner, world },
      with: ['timers']
    })?.timers.every as Record<string, unknown> | undefined;
    if (every?.[name] === undefined) {
      cancelled.push({ message: name, owner });
      world.delete(timer);
    }
  }
  world.flush();
  return cancelled;
};

/**
 * Brings a world kept in a file up to date with a changed EDL (ADR 0005),
 * then makes again what mua derives from it: exits from changed `exits`,
 * and no timers that nothing declares. Homes, verbs and new timers follow
 * when the server next opens the world.
 */
export const migrateWorld = (
  world: MuaWorld,
  edl: string,
  options: MigrateWorldOptions = {}
): WorldMigration => {
  const limbo = findRoomByMetaId(world, LIMBO_META_ID)?.id;
  const prune =
    options.prune && limbo !== undefined
      ? (eid: EntityId) => {
          const entity = world.query({
            entity: { id: eid, world },
            maybe: ['location']
          });
          if (entity) {
            entity.location = { in: limbo };
          }
        }
      : undefined;

  const plan = migrateEDL(world, edl, { path: options.path, prune });

  const exitsRemade = touched(plan, 'exits');
  removeMadeExits(world, exitsRemade);
  expandExits(world);

  const timersCancelled = removeStaleTimers(world);
  return { exitsRemade, plan, timersCancelled };
};
