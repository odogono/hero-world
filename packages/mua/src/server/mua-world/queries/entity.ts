import type { EntityId } from 'odgn-ecs/types';
import type { World } from 'odgn-ecs/world';

import type { MuaComponents } from '../coms';

type ComponentName = keyof MuaComponents;

/**
 * Loads one entity with the given components, or undefined if it lacks any
 * of them. `world.get` only returns the id, so use this to read components.
 * Pass `asProxy` to change components by assignment (then `world.flush()`).
 */
export const getEntity = <const W extends ComponentName[]>(
  world: World<MuaComponents>,
  id: EntityId | undefined,
  components: W,
  asProxy = false
) =>
  id === undefined
    ? undefined
    : world.query({ asProxy, entity: { id, world }, with: components });

/** The id of the entity this one is located in. */
export const getLocationOf = (
  world: World<MuaComponents>,
  id: EntityId | undefined
): EntityId | undefined => getEntity(world, id, ['location'])?.location.in;
