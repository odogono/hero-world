import { Database, Statement } from 'bun:sqlite';
import { z } from 'zod';

import type { ColumnInfo, SchemaType } from './schema/types';

type ComponentCacheEntry<T> = {
  data: T;
  exists: boolean;
};

export type EntityCache = Map<
  number,
  Partial<{
    [K in keyof Components]: ComponentCacheEntry<Components[K]>;
  }>
>;

export type ComponentDef = {
  columns: ColumnInfo[];
  name: string;
  stmtInsert: Statement;
  stmtUpdate: Statement;
  tableName: string;
  url: string;
} & {
  [key: string]: Statement;
};

export const componentSchema = z.object({
  eid: z.int().optional().meta({ cascade: true, foreignKey: 'tbl_entity' }),
  id: z.int().optional().meta({ autoIncrement: true, primaryKey: true })
});

/**
 * Component definition
 */
export type ComponentDefinition<
  Name extends string,
  Schema extends SchemaType
> = {
  name: Name;
  schema: Schema;
  statements?: Record<string, string>;
};

export type Components = Record<string, unknown>;

/**
 * World type that includes component types
 */
export type World<TComponents extends Components> = {
  db: Database;
  defs: Map<string, ComponentDef>;
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entityCache: EntityCache;
  flush: () => World<TComponents>;
  stmts: Record<string, Statement>;
};

export type WorldBuilder<TComponents extends Components> =
  World<TComponents> & {
    build: () => World<TComponents>;
    registerComponent: <Name extends string, Schema extends SchemaType>(
      def: ComponentDefinition<Name, Schema>
    ) => WorldBuilder<TComponents & { [K in Name]: z.infer<Schema> }>;
  };

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
};

export type EntitySchema = z.infer<typeof entitySchema>;
export const entitySchema = z
  .object({
    id: z.number().meta({ autoIncrement: true, primaryKey: true })
    // createdAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
    // updatedAt: z.iso.datetime().meta({ default: 'CURRENT_TIMESTAMP'}),
  })
  .meta({ name: 'tbl_entity' });

// export type ComponentDef = z.infer<typeof componentDefSchema>;
// export const componentDefSchema = z.object({
//   id: z.string().meta({ primaryKey: true, autoIncrement: true }),
//   url: z.string().meta({ unique: true }),
// }).meta({ name: 'tbl_component_def' });

export const isEntity = (val: unknown): val is Entity => {
  if (typeof val !== 'object' || val === null) {
    return false;
  }
  const entity = val as Partial<Entity>;
  return typeof entity.id === 'number';
};

// Type helper for registering components dynamically
export type RegisterComponent<
  Name extends string,
  Schema extends z.ZodTypeAny
> = {
  [K in Name]: z.infer<Schema>;
};
