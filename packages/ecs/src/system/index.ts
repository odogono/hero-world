import { queryEntitiesIterator, type QueryOptions } from '@entity';
import type { Components, World } from '@types';
import { flush } from '@world';

import type { ExecProps, System, SystemFunction, SystemOptions } from './types';

// Export event-aware system functionality
// Re-export the event-aware game loop as the main game loop
export { createGameLoop } from './game-loop';

type SystemFunctionOptions = {
  flush?: boolean;
};

/**
 * Helper to create event-driven system that only processes when specific events are received
 */
// export const createEventDrivenSystem =
//   <TComponents extends Components>(
//     systemFn: (
//       world: World<TComponents>,
//       deltaTime: number,
//       events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
//     ) => void,
//     options?: SystemOptions
//   ): SystemFunction<TComponents> =>
//   (world: World<TComponents>, deltaTime: number, events, options) => {
//     if (events.length === 0) {
//       return;
//     }

//     systemFn(world, deltaTime, events);
//     if (options?.flush ?? true) {
//       flush(world);
//     }
//   };

/**
 * Creates a simple system function that operates on the world directly
 * Compatible with the game loop architecture
 */
// export const createWorldSystem =
//   <TComponents extends Components>(
//     systemFn: (
//       world: World<TComponents>,
//       deltaTime: number,
//       events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
//     ) => void
//   ): SystemFunction<TComponents> =>
//   (world: World<TComponents>, deltaTime: number, events, options) => {
//     systemFn(world, deltaTime, events);
//     if (options?.flush ?? true) {
//       flush(world);
//     }
//   };

/**
 * Creates a system that processes entities one by one with an iterator
 * More memory efficient for large entity sets
 */
// Overloads to infer entity type from `with` keys
// export function createSystem<
//   TComponents extends Components,
//   W extends readonly (keyof TComponents)[]
// >(
//   processFn: (
//     entity: EntityWithComponents<TComponents, W[number]>,
//     world: World<TComponents>,
//     deltaTime: number,
//   ) => void,
//   options?: SystemOptions<TComponents> & { with: W }
// ): SystemFunction<TComponents>;

// export function createSystem<TComponents extends Components>(
//   processFn: (
//     entity: EntityWithComponents<TComponents, never>,
//     world: World<TComponents>,
//     deltaTime: number
//   ) => void,
//   options: SystemOptions<TComponents>
// ): SystemFunction<TComponents>;

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
