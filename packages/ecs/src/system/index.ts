import { queryEntitiesIterator, type QueryOptions } from '@entity';
import type { Components, World } from '@types';
import { flush } from '@world';

import type { ExecProps, System, SystemFunction, SystemOptions } from './types';

// Export event-aware system functionality
// Re-export the event-aware game loop as the main game loop
export { createGameLoop } from './game-loop';

export const createSystem = <
  TComponents extends Components,
  TExecProps extends ExecProps<TComponents>
>(
  processFn: (props: TExecProps) => void,
  options: SystemOptions<TComponents> = {}
): System<TComponents> => {
  const hasQuery = hasQueryOptions<TComponents>(options);

  const exec = ({
    deltaTime,
    flushOnExec = true,
    world
  }: ExecProps<TComponents>) => {
    if (hasQuery) {
      using entities = queryEntitiesIterator(
        world,
        options as QueryOptions<TComponents>
      );

      for (const entity of entities) {
        processFn({ deltaTime, entity, world } as unknown as TExecProps);
      }
    } else {
      processFn({ deltaTime, world } as unknown as TExecProps);
    }

    if (flushOnExec) {
      flush(world);
    }
  };

  return {
    ...options,
    exec
  };
};

/**
 * Wrapper that converts a system function without events to one that ignores events
 */
export const ignoreEvents =
  <TComponents extends Components>(
    systemFn: (world: World<TComponents>, deltaTime: number) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number, _events) => {
    systemFn(world, deltaTime);
  };

export const hasQueryOptions = <T extends Components>(
  options: SystemOptions<T>
) =>
  options.with !== undefined ||
  options.without !== undefined ||
  options.where !== undefined ||
  options.entity !== undefined;
