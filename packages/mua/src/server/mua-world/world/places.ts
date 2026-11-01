import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';
import { findRoomByMetaId } from '../queries/room';

/** The meta ids of the entities every world has */
export const LIMBO_META_ID = 'limbo';
export const SYSTEM_META_ID = 'system';

export type Places = {
  /** Holds what is out of play: stored things, players who have left */
  limbo: EntityId;
  /** The actor behind events no player caused, such as resets */
  system: EntityId;
};

/**
 * Finds Limbo and the system actor, making either if the world's EDL didn't
 * declare it (as an entity with `meta { props: { id: "limbo" } }`).
 */
export const ensurePlaces = (world: World<MuaComponents>): Places => {
  const limbo =
    findRoomByMetaId(world, LIMBO_META_ID)?.id ??
    world.create({
      container: { capacity: 10_000, isClosed: false },
      described: { description: 'Nowhere at all.', name: 'Limbo' },
      meta: { props: { id: LIMBO_META_ID } }
    }).id;
  const system =
    findRoomByMetaId(world, SYSTEM_META_ID)?.id ??
    world.create({
      clock: { now: 0 },
      described: { description: 'The world itself.', name: 'The world' },
      location: { in: limbo },
      meta: { props: { id: SYSTEM_META_ID } }
    }).id;
  // the system actor keeps the world's clock
  const actor = world.query({
    asProxy: true,
    entity: { id: system, world },
    maybe: ['clock'],
    with: ['meta']
  });
  if (actor && !actor.clock) {
    actor.clock = { now: 0 };
  }
  world.flush();
  return { limbo, system };
};
