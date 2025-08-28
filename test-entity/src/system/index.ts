import {
  queryEntities,
  queryEntitiesIterator,
  type QueryOptions
} from '@entity';
import type { Components, Entity, EntityWithComponents, World } from '@types';
import { flush } from '@world';

import type { SystemFunction } from './types';

// Legacy system creation (for backward compatibility)
export const createSystem =
  <E extends Entity<any> | EntityWithComponents<any, any>>(
    world: World<any>,
    fn: (entity: E) => void,
    options?: QueryOptions
  ) =>
  () => {
    const entities = queryEntitiesIterator(world, options);
    for (const e of entities) {
      fn(e as E);
    }
    flush(world);
  };

/**
 * Creates a system function that queries entities and processes them
 * Compatible with the game loop architecture
 */
export const createEntitySystem =
  <
    TComponents extends Components,
    TEntity extends EntityWithComponents<
      TComponents,
      any
    > = EntityWithComponents<TComponents, any>
  >(
    queryOptions: QueryOptions,
    processFn: (
      entities: TEntity[],
      world: World<TComponents>,
      deltaTime: number
    ) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number) => {
    const entities = queryEntities(world, queryOptions) as TEntity[];
    processFn(entities, world, deltaTime);
    flush(world);
  };

/**
 * Creates a simple system function that operates on the world directly
 * Compatible with the game loop architecture
 */
export const createWorldSystem =
  <TComponents extends Components>(
    systemFn: (world: World<TComponents>, deltaTime: number) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number) => {
    systemFn(world, deltaTime);
    flush(world);
  };

/**
 * Creates a system that processes entities one by one with an iterator
 * More memory efficient for large entity sets
 */
export const createIteratorSystem =
  <
    TComponents extends Components,
    TEntity extends EntityWithComponents<
      TComponents,
      any
    > = EntityWithComponents<TComponents, any>
  >(
    queryOptions: QueryOptions,
    processFn: (
      entity: TEntity,
      world: World<TComponents>,
      deltaTime: number
    ) => void
  ): SystemFunction<TComponents> =>
  (world: World<TComponents>, deltaTime: number) => {
    const entities = queryEntitiesIterator(world, queryOptions);
    for (const entity of entities) {
      processFn(entity as TEntity, world, deltaTime);
    }
    flush(world);
  };
