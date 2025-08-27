import { makeTrackedComponent } from "./component";
import type { Components, Entity, World } from "./types";


/**
 * Entity type for a world with specific components
 */
export type EntityWithComponents<
  TComponents extends Record<string, any>,
  C extends keyof TComponents = never
> = {
  id: number;
  world: World<TComponents>;
} & {
  [K in C]-?: NonNullable<TComponents[K]>;
}


// Overloads for type inference
interface CreateEntityOverloads {
  <T extends Partial<Components>>(world: World<T>, initialComponents: T): Entity<keyof T & string>;
  <T extends Partial<Components>>(world: World<T>): Entity<never>;
}

export const createEntity: CreateEntityOverloads = 
  <
  TComponents extends Record<string, any>,
  C extends Partial<TComponents>
>(
  world: World<TComponents>,
  initialComponents?: C
): EntityWithComponents<TComponents, keyof C & keyof TComponents> => {
  const eid = world.stmts.insertEntity!.run().lastInsertRowid as number;
  
  const entity: any = { id: eid, world };
  world.entityCache.set(eid, {});
  if (initialComponents) {
    for (const [c, data] of Object.entries(initialComponents)) {
      const name = c as string;
      if (data) {
        entity[name] = makeTrackedComponent(entity, name, {...data} as any, false);

        if (!world.dirtyEntities.has(eid)) {
          world.dirtyEntities.set(eid, new Set());
        }
        world.dirtyEntities.get(eid)!.add(name);
      }
    }
  }
  return entity as EntityWithComponents<TComponents, keyof C & keyof TComponents>;
}