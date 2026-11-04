import {
  addComponent,
  applyComponentDefaults,
  makeTrackedComponent,
  removeComponent
} from '../component';
import { SQLiteError } from '../error';
import {
  ident,
  select,
  type Condition,
  type Order,
  type QueryOptions as StoreQueryOptions
} from '../store';
import type {
  Components,
  Entity,
  EntityWithComponents,
  GenericEntity
} from '../types';
import type { World } from '../world';

// Overloads for type inference
type CreateEntityOverloads = {
  <TComponents extends Components, C extends Partial<TComponents>>(
    world: World<TComponents>,
    initialComponents: C
  ): EntityWithComponents<TComponents, keyof C & keyof TComponents>;
  <TComponents extends Components>(
    world: World<TComponents>
  ): EntityWithComponents<TComponents, never>;
};

// Helper type: turn union into intersection
// type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
//   k: infer I
// ) => void
//   ? I
//   : never;

export const createEntity: CreateEntityOverloads = <
  TComponents extends Components,
  C extends Partial<TComponents>
>(
  world: World<TComponents>,
  initialComponents?: C
): EntityWithComponents<TComponents, keyof C & keyof TComponents> => {
  const eid = world.db.addEntity();
  world.noteChange(eid, true);

  const entity: GenericEntity<TComponents> & Record<string, unknown> = {
    id: eid,
    world
  };
  world.entityCache.set(eid, {});
  if (initialComponents) {
    for (const [c, data] of Object.entries(initialComponents)) {
      const name = c as string;
      if (data) {
        // Apply default values from the component schema
        const dataWithDefaults = applyComponentDefaults(world, name, data);

        entity[name] = makeTrackedComponent(
          entity,
          name,
          dataWithDefaults,
          false
        );

        if (!world.dirtyEntities.has(eid)) {
          world.dirtyEntities.set(eid, new Set());
        }
        world.dirtyEntities.get(eid)!.add(name);
      }
    }
  }
  // Wrap in a Proxy that intercepts component add/remove via assignment
  const proxied = proxyEntity(world, entity);

  return proxied as EntityWithComponents<
    TComponents,
    keyof C & keyof TComponents
  >;
};

export const isEntity = (val: unknown): val is Entity => {
  if (typeof val !== 'object' || val === null) {
    return false;
  }
  const entity = val as Partial<Entity>;
  return typeof entity.id === 'number';
};

export type QueryOptions<T extends Components> = {
  args?: unknown[];
  /**
   * Results are proxies, so assigning a component adds it and assigning
   * null removes it (saved on flush). Pass false for plain objects.
   */
  asProxy?: boolean;
  entity?: GenericEntity<T>;
  limit?: number;
  // Optionally include these components if present on the entity.
  // They are not required to exist and will be omitted if missing.
  maybe?: readonly (keyof T)[];
  offset?: number;
  /** `[component, property, direction?]`; entity id breaks ties */
  orderBy?: readonly Order[];
  /**
   * Conditions that all hold, as the store takes them
   * (`[component, property, op?, value]`), or a raw SQL condition in which
   * each component is joined under its name, with `args` for its `?`s
   */
  where?: string | readonly Condition[];
  with?: readonly (keyof T)[];
  without?: readonly (keyof T)[];
};

/**
 * Rewrites `component.column.path` in a raw condition, for a json column, to
 * `json_extract(component.column, '$.path')`
 */
const rewriteJsonDotPaths = <T extends Components>(
  world: World<T>,
  where: string
) => {
  const re =
    /\b([A-Z_a-z]\w*)\.([A-Z_a-z]\w*)(?:\.((?:[A-Z_a-z]\w*|\d+)(?:\.(?:[A-Z_a-z]\w*|\d+))*))?/g;
  return where.replaceAll(
    re,
    (full, alias: string, col: string, rest: string | undefined) => {
      const column = world.defs
        .get(alias)
        ?.component.columns.find(c => c.name === col);
      if (!column) {
        return full;
      }
      // quoted, so a column may be named like a keyword (`contained.in`)
      const ref = `${ident(alias)}.${ident(col)}`;
      if (!rest) {
        return ref;
      }
      return column.type === 'json'
        ? `json_extract(${ref}, '$.${rest}')`
        : full;
    }
  );
};

/** The store query for a World query, and the components it reads */
const buildQuery = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
): { names: string[]; opts: StoreQueryOptions } => {
  const withList = (options?.with ?? []) as string[];
  const maybeList = (options?.maybe ?? []) as string[];
  for (const c of [
    ...withList,
    ...maybeList,
    ...((options?.without ?? []) as string[])
  ]) {
    if (!world.defs.has(c)) {
      throw new Error(`Component def not found for ${c}`);
    }
  }
  const raw = typeof options?.where === 'string' ? options.where : undefined;
  let names = [...new Set([...withList, ...maybeList])];
  // a raw condition can name any component
  const joinAll = raw !== undefined && names.length === 0;
  if (joinAll) {
    names = [...world.defs.keys()];
  }
  const opts: StoreQueryOptions = {
    with: withList,
    ...(options?.without ? { without: options.without as string[] } : {}),
    ...(Array.isArray(options?.where)
      ? { where: options.where as Condition[] }
      : {}),
    ...(raw !== undefined
      ? {
          sql: {
            args: options?.args ?? [],
            where: rewriteJsonDotPaths(world, raw)
          }
        }
      : {}),
    ...(options?.entity ? { eids: [options.entity.id] } : {}),
    ...(options?.orderBy ? { orderBy: options.orderBy } : {}),
    ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    ...(options?.offset !== undefined ? { offset: options.offset } : {})
  };
  return { names: joinAll ? names : names, opts };
};

/** A stored value as the entity holds it: a `datetime` is a Date */
const fromStored = (type: string | undefined, value: unknown) =>
  type === 'datetime' && typeof value === 'string' ? new Date(value) : value;

export const mapRowToEntity = <T extends Components>(
  world: World<T>,
  [eid, components]: [number, Record<string, Record<string, unknown>>]
) => {
  const entity = { id: eid, world } as Entity<keyof Components>;
  for (const [name, stored] of Object.entries(components)) {
    const def = world.defs.get(name)!;
    const data: Record<string, unknown> = {};
    for (const col of def.schema.columns) {
      data[col.name] = fromStored(col.type, stored[col.name]);
    }
    (entity as Record<PropertyKey, unknown>)[name] = makeTrackedComponent(
      entity,
      name,
      data,
      true,
      'read'
    );
  }
  return entity;
};

const run = <T extends Components>(
  world: World<T>,
  options: QueryOptions<T> | undefined
) => {
  const { names, opts } = buildQuery(world, options);
  try {
    return select(world.store, names, opts).map(row =>
      mapRowToEntity(world, row)
    );
  } catch (error) {
    if (typeof options?.where === 'string') {
      throw SQLiteError.executionError(options.where, error as Error, {
        args: options.args,
        context: options
      });
    }
    throw error;
  }
};

/**
 * Create a Proxy wrapper around an entity object that intercepts
 * component add/remove via property assignment.
 */
const proxyEntity = <T extends Components>(
  world: World<T>,
  entity: GenericEntity<T>
) =>
  new Proxy(entity as GenericEntity<T> & Record<PropertyKey, unknown>, {
    set(target, prop, value) {
      const propName = String(prop);

      // Add/replace component by assignment of an object
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        typeof value === 'object' &&
        value !== null
      ) {
        if (world.defs.has(propName)) {
          addComponent(target, propName, value as T[keyof T]);
          return true;
        }
      }

      // Remove component by assigning null/undefined
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        (value === null || value === undefined)
      ) {
        if (world.defs.has(propName)) {
          removeComponent(target, propName);
          return true;
        }
      }

      // Fallback to normal set
      target[prop] = value;
      return true;
    }
  });

/**
 * Wrap a queried entity in a Proxy to intercept component add/remove via
 * property assignment, matching the ergonomics of createEntity.
 */
export const asProxiedEntity = <T extends Components>(
  entity: GenericEntity<T>
) => {
  const { world } = entity;
  return proxyEntity(world, entity) as GenericEntity<T>;
};

/**
 * Query a single entity
 * @param world
 * @param options
 * @returns
 */
// Overloads to narrow result based on `with` keys
export function queryEntity<
  T extends Components,
  W extends readonly (keyof T)[]
>(
  world: World<T>,
  options: QueryOptions<T> & { with: W }
): EntityWithComponents<T, W[number]> | null;
export function queryEntity<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
): EntityWithComponents<T, never> | null;
export function queryEntity<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) {
  let result = run(world, { ...options, limit: 1 })[0] ?? null;
  if (result && (options?.asProxy ?? true)) {
    result = asProxiedEntity(result as GenericEntity<T>) as typeof result;
  }
  return result;
}

export function queryEntities<
  T extends Components,
  W extends readonly (keyof T)[]
>(
  world: World<T>,
  options: QueryOptions<T> & { with: W }
): Array<EntityWithComponents<T, W[number]>>;
export function queryEntities<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
): Array<EntityWithComponents<T, never>>;
export function queryEntities<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) {
  const asProxy = options?.asProxy ?? true;
  const entities = run(world, options);

  if (asProxy) {
    return entities.map(e => asProxiedEntity(e as GenericEntity<T>));
  }

  return entities;
}

export function queryEntitiesIterator<
  T extends Components,
  W extends readonly (keyof T)[]
>(
  world: World<T>,
  options: QueryOptions<T> & { with: W }
): {
  [Symbol.iterator](): IterableIterator<EntityWithComponents<T, W[number]>>;
} & {
  [Symbol.dispose](): void;
};
export function queryEntitiesIterator<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
): { [Symbol.iterator](): IterableIterator<EntityWithComponents<T, never>> } & {
  [Symbol.dispose](): void;
};
export function queryEntitiesIterator<T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) {
  const asProxy = options?.asProxy ?? true;
  const entities = run(world, options);
  return {
    [Symbol.dispose]: () => {},
    *[Symbol.iterator]() {
      for (const entity of entities) {
        yield asProxy ? asProxiedEntity(entity as GenericEntity<T>) : entity;
      }
    }
  };
}
