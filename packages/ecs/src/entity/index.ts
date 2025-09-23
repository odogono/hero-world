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

import { needsQuoting, q } from '../db/sql-helpers';
import { SQLiteError } from '../error';

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
  // If true, wrap the returned entity/entities in a proxy that intercepts
  // component add/remove via property assignment, similar to createEntity
  asProxy?: boolean;
  entity?: GenericEntity<T>;
  limit?: number;
  offset?: number;
  where?: string;
  with?: (keyof T)[];
  without?: (keyof T)[];
};

const rewriteJsonDotPaths = <T extends Components>(
  world: World<T>,
  included: (keyof T)[] | undefined,
  where: string
) => {
  // Build alias → set(json columns) map
  const aliasInfo = new Map<string, Set<string>>();
  const names =
    included && included.length
      ? included
      : (Array.from(world.defs.keys()) as (keyof T)[]);
  for (const c of names) {
    const def = world.defs.get(c as string);
    if (!def) continue;
    const alias = toSnakeCase(def.name);
    const jsonCols = new Set(
      (def.schema?.columns ?? [])
        .filter(col => col.type === 'json')
        .map(col => toSnakeCase(col.name) || col.name)
    );
    aliasInfo.set(alias, jsonCols);
  }

  // Match alias.col or alias.col.path...
  const re =
    /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)(?:\.((?:[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|\d+))*))?/g;

  return where.replace(re, (full, alias, col, rest) => {
    const jsonCols = aliasInfo.get(alias);
    const snakeCol = toSnakeCase(col) ?? col;
    if (rest) {
      // alias.col.rest - check if JSON
      if (!jsonCols || !jsonCols.has(snakeCol)) return full;
      const jsonPath = `$.${rest}`;
      return `json_extract(${alias}.${q(snakeCol)}, '${jsonPath}')`;
    } else {
      // alias.col - quote if reserved
      if (needsQuoting(col)) {
        return `${alias}.${q(col)}`;
      }
      return full;
    }
  });
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
  // Determine default join behavior:
  // - If explicit `with` is provided, join only those.
  // - Else, if filtering via `where` or `without`, join all component tables so unqualified
  //   column names in WHERE can resolve.
  // - Else (no `with`/`where`/`without`), return all entities without joins.
  const needsJoins =
    Boolean(options?.where) || (options?.without?.length ?? 0) > 0;
  const componentsToInclude =
    options?.with ??
    (needsJoins
      ? (Array.from(world.defs.keys()) as (keyof T)[])
      : ([] as (keyof T)[]));

  // console.log('componentsToInclude', world.defs.keys());

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
      const field = `${alias}.${q(name)} AS ${alias}_${name}`;
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
    const clause = rewriteJsonDotPaths(
      world,
      componentsToInclude,
      options.where
    );
    conditions.push(clause);
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
  const selectFields = fields.length > 0 ? `, ${fields.join(', ')}` : '';
  const sql = `${base}${selectFields}\nFROM tbl_entity AS e\n${joins.join('\n')}\n${whereClause}${limitOffsetClause}`;

  // console.log('sql', sql);
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
      const schemaColumn = def.schema.columns.find(
        c => (toSnakeCase(c.name) || c.name) === column.name
      );
      const key = toCamelCase(column.name);
      const value = row[`${defName}_${column.name}`];
      data[key] =
        schemaColumn && schemaColumn.type === 'json' && value !== null
          ? JSON.parse(value as string)
          : value;
    }
    entity[c] = makeTrackedComponent(entity, c as string, data);
  }

  return entity;
};

/**
 * Create a Proxy wrapper around an entity object that intercepts
 * component add/remove via property assignment.
 */
const proxyEntity = <T extends Components>(world: World<T>, entity: any) =>
  new Proxy(entity, {
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
          addComponent(target, propName as any, value);
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
          removeComponent(target, propName as any);
          return true;
        }
      }

      // Fallback to normal set
      (target as any)[prop] = value;
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
  if (result && options?.asProxy) {
    result = asProxiedEntity(result as any) as any;
  }
  return result as any;
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
  const { args, componentsToInclude, sql } = buildQuery(world, options);
  const asProxy = options?.asProxy ?? false;

  const rows = world.db.query(sql, args);

  const entities = rows.map((row: any) =>
    mapRowToEntity(world, componentsToInclude, row)
  );

  if (asProxy) {
    return entities.map(e => asProxiedEntity(e as any)) as any;
  }

  return entities as any;
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
  const { args, componentsToInclude, sql } = buildQuery(world, options);
  const stmt = world.db.prepare(sql);
  const asProxy = options?.asProxy ?? false;
  let finalized = false;

  const finalize = () => {
    if (finalized) {
      return;
    }
    finalized = true;
    try {
      stmt.finalize();
    } catch {
      /* ignore double finalize */
    }
  };

  // Use Bun's iterate capability for incremental results
  const iterator =
    args && args.length > 0 ? stmt.iterate(args) : stmt.iterate();

  return {
    [Symbol.dispose]: () => {
      finalize();
    },
    *[Symbol.iterator]() {
      try {
        for (const row of iterator) {
          let entity = mapRowToEntity(world, componentsToInclude, row);
          if (asProxy) {
            entity = asProxiedEntity(entity as any) as any;
          }
          yield entity as any;
        }
      } catch (error) {
        throw SQLiteError.executionError(sql, error as Error, {
          args,
          context: options
        });
      } finally {
        finalize();
      }
    }
  } as any;
}
