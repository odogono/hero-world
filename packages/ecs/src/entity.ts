import type { SQLQueryBindings } from 'bun:sqlite';
import { toCamelCase } from 'odgn-helpers';

import { makeTrackedComponent } from '@component';
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

export const createEntity: CreateEntityOverloads = <
  TComponents extends Components,
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
        entity[name] = makeTrackedComponent(
          entity,
          name,
          { ...data } as any,
          false
        );

        if (!world.dirtyEntities.has(eid)) {
          world.dirtyEntities.set(eid, new Set());
        }
        world.dirtyEntities.get(eid)!.add(name);
      }
    }
  }
  return entity as EntityWithComponents<
    TComponents,
    keyof C & keyof TComponents
  >;
};

export const deleteEntity = <T extends Components>(
  entity: GenericEntity<T>
) => {
  const { id, world } = entity;

  world.stmts.deleteEntity!.run(id);

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
  const eid = stmt.get(id);

  return eid ? ({ id: eid, world } as GenericEntity<T>) : null;
};

export type QueryOptions<T extends Components> = {
  args?: SQLQueryBindings[];
  entity?: GenericEntity<T>;
  limit?: number;
  offset?: number;
  where?: string;
  with?: (keyof Components)[];
  without?: (keyof Components)[];
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
    const alias = def.name;
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

const mapRowToEntity = <T extends Components>(
  world: World<T>,
  componentsToInclude: (keyof T)[],
  row: unknown
) => {
  const entity: Entity<keyof Components> = { id: row.eid, world } as Entity<
    keyof Components
  >;

  for (const c of componentsToInclude) {
    const def = world.defs.get(c as string)!;
    const data: Record<string, unknown> = {};
    for (const column of def.columns) {
      const key = toCamelCase(column.name);
      data[key] = row[`${def.name}_${column.name}`];
    }
    entity[c] = makeTrackedComponent(entity, c as string, data);
  }

  return entity;
};

export const queryEntities = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const { args, componentsToInclude, sql } = buildQuery(world, options);

  const stmt = world.db.query(sql);
  const rows = args && args.length > 0 ? stmt.all(...args) : stmt.all();

  return rows.map((row: any) =>
    mapRowToEntity(world, componentsToInclude, row)
  );
};

export const queryEntitiesIterator = <T extends Components>(
  world: World<T>,
  options?: QueryOptions<T>
) => {
  const { args, componentsToInclude, sql } = buildQuery(world, options);
  const stmt = world.db.query(sql);

  // Use Bun's iterate capability for incremental results
  const iterator =
    args && args.length > 0 ? stmt.iterate(...args) : stmt.iterate();

  return {
    *[Symbol.iterator]() {
      for (const row of iterator) {
        const entity = mapRowToEntity(world, componentsToInclude, row);
        yield entity;
      }
    }
  };
};
