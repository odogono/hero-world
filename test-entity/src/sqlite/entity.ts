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
type CreateEntityOverloads = {
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



export const deleteEntity = <T extends Components>(entity: Entity<any>) => {
  const { id, world } = entity;

  // log.debug('[deleteEntity] foreign_keys', world.db.query('PRAGMA foreign_keys').get());
  
  world.stmts.deleteEntity!.run(id);

  // Clean up caches
  world.entityCache.delete(id);
  world.dirtyEntities.delete(id);

  return null;
}




export const getEntity = <T extends Components>(world: World<T>, id: number) => {
  const stmt = world.stmts.selectEntityById;
  if (!stmt) {
    throw new Error('selectEntityById not found');
  }
  const eid = stmt.get(id);

  return eid ? { id: eid, world } as Entity<any> : null;
}



export const queryEntities = <T extends Components>(
  world: World<T>, 
  components: (keyof T)[], 
  options?: { where?: string; entity?: Entity<any> }
) => {

  const base = `SELECT e.id AS eid`;
  const joins: string[] = [];
  const fields: string[] = [];
  components.forEach(c => {
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

  let whereClause = '';
  if (options?.entity) {
    whereClause = `WHERE e.id = ${options.entity.id} LIMIT 1`;
  } else if (options?.where) {
    whereClause = `WHERE ${options.where}`;
  }

  // TODO cache sql against components
  const sql = `${base}, ${fields.join(', ')}\nFROM tbl_entity AS e\n${joins.join('\n')}\n${whereClause}`;
  const stmt = world.db.query(sql);
  const rows = stmt.all();

  return rows.map((row: any) => {
    const entity: Entity<any> = { id: row.eid, world } as Entity<any>;
    
    components.forEach(c => {
      const def = world.defs.get(c as string)!;
      const data: any = {};
      def.columns.forEach(column => {
        data[column.name] = row[`${def.name}_${column.name}`];
      })
      entity[c] = makeTrackedComponent(entity, c as string, data);
    });

    return entity;
  });
}
