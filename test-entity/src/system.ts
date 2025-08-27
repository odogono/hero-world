import type { EntityWithComponents, QueryOptions } from "./entity";
import type { Entity, World } from './types';
import { flush } from './world';
import { queryEntitiesIterator } from "./entity";

export const createSystem = <
E extends Entity<any> | EntityWithComponents<any, any>,
> (
  world: World<any>,
  fn: (entity: E) => void,
  options?: QueryOptions
) => {
  return () => {
    const entities = queryEntitiesIterator(world, options);
    for (const e of entities) {
      fn(e);
    }
    flush(world);
  };
}