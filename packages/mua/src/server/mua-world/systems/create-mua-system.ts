import {
  createSystem,
  type EntityExecProps,
  type SystemOptions
} from 'odgn-ecs/system';
import type { EntityWithComponents } from 'odgn-ecs/types';

import type { MuaComponents } from '../coms';

type ComponentName = keyof MuaComponents;

/**
 * `createSystem` for MUA, typed so that `entity` carries the components named
 * in `with`. The ECS calls the function once per matching entity.
 */
export const createMuaSystem = <const W extends readonly ComponentName[]>(
  fn: (
    props: EntityExecProps<
      EntityWithComponents<MuaComponents, W[number]>,
      MuaComponents
    >
  ) => void,
  options: Omit<SystemOptions<MuaComponents>, 'with'> & { with: W }
) =>
  createSystem<
    MuaComponents,
    EntityExecProps<
      EntityWithComponents<MuaComponents, W[number]>,
      MuaComponents
    >
  >(fn, options as SystemOptions<MuaComponents>);
