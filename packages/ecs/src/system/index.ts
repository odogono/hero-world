import { queryEntitiesIterator, type QueryOptions } from '@entity';
import type { Components, Entity, EntityWithComponents, World } from '@types';
import { flush } from '@world';

import type { SystemFunction } from './types';

// Export event-aware system functionality
// Re-export the event-aware game loop as the main game loop
export { createEventAwareGameLoop as createGameLoop } from './game-loop';

/**
 * Creates a simple system function that operates on the world directly
 * Compatible with the game loop architecture
 */
export const createWorldSystem =
  <TComponents extends Components>(
    systemFn: (
      world: World<TComponents>,
      deltaTime: number,
      events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
    ) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number, events) => {
    systemFn(world, deltaTime, events);
    flush(world);
  };

/**
 * Creates a system that processes entities one by one with an iterator
 * More memory efficient for large entity sets
 */
export const createSystem =
  <
    TComponents extends Components,
    TEntity extends EntityWithComponents<
      TComponents,
      any
    > = EntityWithComponents<TComponents, any>
  >(
    processFn: (
      entity: TEntity,
      world: World<TComponents>,
      deltaTime: number,
      events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
    ) => void,
    queryOptions?: QueryOptions<TComponents>
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number, events) => {
    const entities = queryEntitiesIterator(world, queryOptions);

    for (const entity of entities) {
      processFn(entity as TEntity, world, deltaTime, events);
    }

    flush(world);
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

/**
 * Helper to create event-driven system that only processes when specific events are received
 */
export const createEventDrivenSystem =
  <TComponents extends Components>(
    eventTypes: string[],
    systemFn: (
      world: World<TComponents>,
      deltaTime: number,
      events: Array<{ entity: Entity<'event'>; payload: any; type: string }>
    ) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number, events) => {
    // Only run if we have events of the specified types
    const relevantEvents = events.filter(event =>
      eventTypes.includes(event.type)
    );
    if (relevantEvents.length > 0) {
      systemFn(world, deltaTime, relevantEvents);
      flush(world);
    }
  };
