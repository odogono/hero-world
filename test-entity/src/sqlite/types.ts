import * as z from "zod";
import type { Location } from "./location";
// import type { ComponentRegistry } from "./component-registry";
import { Database, Statement } from 'bun:sqlite';
import type { ColumnInfo } from "./schema-to-sql";



type ComponentCacheEntry<T> = {
  data: T;
  exists: boolean;
}


export type EntityCache = Map<number, Partial<{
  [K in keyof Components]: ComponentCacheEntry<Components[K]>
}>>;


export type ComponentDef = {
  url: string;
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  stmtInsert: Statement;
  stmtUpdate: Statement;
} & {
  [key: string]: Statement;
}



export type Components = Record<string, any>;

/**
 * World type that includes component types
 */
export type World<TComponents extends Components> = {
  db: Database;
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entityCache: EntityCache;
  defs: Map<string, ComponentDef>;
  stmts: Record<string, Statement>;
  // _componentTypes: TComponents;
}

// export type World = {
//   db: Database;
//   dirtyEntities: Map<number, Set<keyof Components>>;
//   entityCache: EntityCache;
//   defs: Map<string, ComponentDef>;
//   stmts: {
//     [key: string]: Statement;
//   }
// }

export type Entity<C extends keyof Components = never> = EntitySchema & {
  world: World<Components>;
} & {
  [K in C]-?: NonNullable<Components[K]>;
}

export type EntitySchema = z.infer<typeof entitySchema>;
export const entitySchema = z.object({
  id: z.number().meta({ primaryKey: true, autoIncrement: true }),
  // createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
  // updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
}).meta({ name: 'tbl_entity' });

// export type ComponentDef = z.infer<typeof componentDefSchema>;
// export const componentDefSchema = z.object({
//   id: z.string().meta({ primaryKey: true, autoIncrement: true }),
//   url: z.string().meta({ unique: true }),
// }).meta({ name: 'tbl_component_def' });


export const isEntity = (val: unknown): val is Entity => {
  if (typeof val !== 'object' || val === null) return false;
  const entity = val as Partial<Entity>;
  return typeof entity.id === 'number';
}

// Type helper for registering components dynamically
export type RegisterComponent<Name extends string, Schema extends z.ZodTypeAny> = {
  [K in Name]: z.infer<Schema>
}