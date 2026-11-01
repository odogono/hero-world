import {
  createSystem,
  type EntityExecProps,
  type ExecProps,
  type System,
  type SystemOptions
} from 'odgn-ecs/system';
import type { EntityWithComponents } from 'odgn-ecs/types';

import type { MuaComponents } from '../coms';

type ComponentName = keyof MuaComponents;

/**
 * `createSystem` for MUA, typed so that `entity` carries the components named
 * in `with`. The ECS calls the function once per matching entity.
 *
 * The world is saved after the system runs, so the entities it creates are
 * seen by the next system in the same tick: a command goes from input to
 * output in one tick. (The game loop itself only saves at the end.)
 */
export const createMuaSystem = <const W extends readonly ComponentName[]>(
  fn: (
    props: EntityExecProps<
      EntityWithComponents<MuaComponents, W[number]>,
      MuaComponents
    >
  ) => void,
  options: Omit<SystemOptions<MuaComponents>, 'with'> & { with: W }
): System<MuaComponents> => {
  const system = createSystem<
    MuaComponents,
    EntityExecProps<
      EntityWithComponents<MuaComponents, W[number]>,
      MuaComponents
    >
  >(fn, options as SystemOptions<MuaComponents>);
  return {
    ...system,
    exec: (props: ExecProps<MuaComponents>) => {
      system.exec(props);
      props.world.flush();
    }
  };
};
