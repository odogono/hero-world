import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import {
  addComponent,
  applyComponentDefaults,
  makeTrackedComponent,
  removeComponent
} from '@component';
import type {
  Components,
  Entity,
  EntityWithComponents,
  GenericEntity,
  World
} from '@types';

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
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

export const createEntity: CreateEntityOverloads = <
  TComponents extends Components,
  C extends Partial<TComponents>
>(
  world: World<TComponents>,
  initialComponents?: C
): EntityWithComponents<TComponents, keyof C & keyof TComponents> => {
  const eid = world.db.addEntity();

  const entity: any = { id: eid, world };
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

  // Create a Proxy that intercepts property assignments to automatically add components
  const entityProxy = new Proxy(entity, {
    set(target, prop, value) {
      const propName = String(prop);

      // Check if this is a component property assignment
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        typeof value === 'object' &&
        value !== null
      ) {
        // Check if this component is registered in the world
        if (world.defs.has(propName)) {
          // This is a component assignment, use addComponent
          addComponent(target, propName, value);
          return true;
        }
      }

      // Check if this is a component deletion (null or undefined)
      if (
        propName !== 'id' &&
        propName !== 'world' &&
        (value === null || value === undefined)
      ) {
        // Check if this component is registered in the world
        if (world.defs.has(propName)) {
          // This is a component deletion, use removeComponent
          removeComponent(target, propName);
          return true;
        }
      }

      // Default property assignment
      target[prop] = value;
      return true;
    }
  });

  return entityProxy as EntityWithComponents<
    TComponents,
    keyof C & keyof TComponents
  >;
};

export const deleteEntity = <T extends Components>(
  entity: GenericEntity<T>
) => {
  const { id, world } = entity;

  // Mark entity for deletion instead of immediate deletion
  world.entitiesToDelete.add(id);

  // Clean up caches
  world.entityCache.delete(id);
  world.dirtyEntities.delete(id);

  return null;
};

export const getEntity = <T extends Components>(
  world: World<T>,
  id: number
) => {
  const stmt = world.stmts.selectEntityById;
  if (!stmt) {
    throw new Error('selectEntityById not found');
  }
  const eid = stmt.get(id) as { id: number } | null;

  return eid ? ({ id: eid.id, world } as GenericEntity<T>) : null;
};

export type QueryOptions<T extends Components> = {
  args?: unknown[];
  entity?: GenericEntity<T>;
  limit?: number;
  offset?: number;
  where?: string;
  with?: (keyof Components)[];
  without?: (keyof Components)[];
  // If true, wrap the returned entity/entities in a proxy that intercepts
  // component add/remove via property assignment, similar to createEntity
  proxied?: boolean;
};

const buildQuery = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const base = `SELECT e.id AS eid`;
  const joins: string[] = [];
  const fields: string[] = [];
  const withoutConditions: string[] = [];

  // Determine which components to include in the query
  const componentsToInclude =
    options?.with ?? (Array.from(world.defs.keys()) as (keyof T)[]);

  // Handle components that entities must have
  componentsToInclude.forEach(c => {
    const def = world.defs.get(c as string);
    if (!def) {
      throw new Error(`Component def not found for ${String(c)}`);
    }
    const alias = toSnakeCase(def.name);
    const join = `JOIN ${def.tableName} AS ${alias} ON ${alias}.eid = e.id`;
    joins.push(join);
    def.columns.forEach(column => {
      const name = column.name;
      const field = `${alias}.${name} AS ${alias}_${name}`;
      fields.push(field);
    });
  });

  // Handle components that entities must NOT have
  if (options?.without) {
    options.without.forEach(c => {
      const def = world.defs.get(c as string);
      if (!def) {
        throw new Error(`Component def not found for ${String(c)}`);
      }
      const alias = `${def.name}_not`;
      const join = `LEFT JOIN ${def.tableName} AS ${alias} ON ${alias}.eid = e.id`;
      joins.push(join);
      withoutConditions.push(`${alias}.eid IS NULL`);
    });
  }

  let whereClause = '';
  const conditions: string[] = [];

  if (options?.entity) {
    conditions.push(`e.id = ${options.entity.id}`);
  } else if (options?.where) {
    conditions.push(options.where);
  }

  // Add WITHOUT conditions
  if (withoutConditions.length > 0) {
    conditions.push(...withoutConditions);
  }

  if (conditions.length > 0) {
    whereClause = `WHERE ${conditions.join(' AND ')}`;
  }

  // Build LIMIT and OFFSET clauses
  let limitOffsetClause = '';
  if (options?.limit !== undefined) {
    limitOffsetClause += ` LIMIT ${options.limit}`;
    if (options?.offset !== undefined) {
      limitOffsetClause += ` OFFSET ${options.offset}`;
    }
  } else if (options?.offset !== undefined) {
    // In SQLite, OFFSET requires LIMIT, so we use a very large limit
    limitOffsetClause += ` LIMIT -1 OFFSET ${options.offset}`;
  }

  // TODO cache sql against components
  const sql = `${base}, ${fields.join(', ')}\nFROM tbl_entity AS e\n${joins.join('\n')}\n${whereClause}${limitOffsetClause}`;

  return {
    args: options?.args,
    componentsToInclude,
    sql
  };
};

export const mapRowToEntity = <T extends Components>(
  world: World<T>,
  componentsToInclude: (keyof T)[],
  row: unknown
) => {
  const entity: Entity<keyof Components> = { id: row.eid, world } as Entity<
    keyof Components
  >;

  for (const c of componentsToInclude) {
    const def = world.defs.get(c as string)!;
    const defName = toSnakeCase(def.name);
    const data: Record<string, unknown> = {};
    for (const column of def.columns) {
      const key = toCamelCase(column.name);
      data[key] = row[`${defName}_${column.name}`];
    }
    entity[c] = makeTrackedComponent(entity, c as string, data);
  }

  return entity;
};

/**
 * Wrap a queried entity in a Proxy to intercept component add/remove via
 * property assignment, matching the ergonomics of createEntity.
 */
export const asProxiedEntity = <T extends Components>(
  entity: GenericEntity<T>
) => {
  const { world } = entity;
  return new Proxy(entity as any, {
    set(target, prop, value) {
      const propName = String(prop);

      if (
        propName !== 'id' &&
        propName !== 'world' &&
        typeof value === 'object' &&
        value !== null
      ) {
        if (world.defs.has(propName)) {
          addComponent(target, propName as any, value);
          return true;
        }
      }

      if (
        propName !== 'id' &&
        propName !== 'world' &&
        (value === null || value === undefined)
      ) {
        if (world.defs.has(propName)) {
          removeComponent(target, propName as any);
          return true;
        }
      }

      target[prop] = value;
      return true;
    }
  }) as GenericEntity<T>;
};

/**
 * Query a single entity
 * @param world
 * @param options
 * @returns
 */
export const queryEntity = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const { args, componentsToInclude, sql } = buildQuery(world, {
    ...options,
    limit: 1
  });
  // console.debug('queryEntity', sql);
  const stmt = world.db.prepare(sql);
  const row = args && args.length > 0 ? stmt.get(...args) : stmt.get();
  // console.debug('row', row);
  let result = row ? mapRowToEntity(world, componentsToInclude, row) : null;
  stmt.finalize();
  if (result && options?.proxied) {
    result = asProxiedEntity(result as any) as any;
  }
  return result;
};

export const queryEntities = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const { args, componentsToInclude, sql } = buildQuery(world, options);

  const rows = world.db.query(sql, args);

  const entities = rows.map((row: any) =>
    mapRowToEntity(world, componentsToInclude, row)
  );

  if (options?.proxied) {
    return entities.map(e => asProxiedEntity(e as any)) as any;
  }

  return entities;
};

export const queryEntitiesIterator = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const { args, componentsToInclude, sql } = buildQuery(world, options);
  const stmt = world.db.prepare(sql);

  // Use Bun's iterate capability for incremental results
  const iterator =
    args && args.length > 0 ? stmt.iterate(...args) : stmt.iterate();

  return {
    *[Symbol.iterator]() {
      for (const row of iterator) {
        let entity = mapRowToEntity(world, componentsToInclude, row);
        if (options?.proxied) {
          entity = asProxiedEntity(entity as any) as any;
        }
        yield entity;
      }
    }
  };
};
