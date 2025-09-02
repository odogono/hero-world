import { z } from 'zod';

import type { Database, Statement } from '@db';

import { pkWithAutoIncrement } from './schema';
import type { ColumnInfo, SchemaType } from './schema/types';

export type EntityId = number;

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
  schema: SchemaType; // Add schema to access defaults
  stmtInsert: Statement;
  stmtUpdate: Statement;
  tableName: string;
  url: string;
} & {
  [key: string]: Statement;
};

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
  close: () => void;
  db: Database;
  defs: Map<string, ComponentDef>;
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entitiesToDelete: Set<number>;
  entityCache: EntityCache;
  flush: () => World<TComponents>;
  registry: ReturnType<typeof z.registry>;
  stmts: Record<string, Statement>;
};

export type WorldBuilder<TComponents extends Components> =
  World<TComponents> & {
    build: () => World<TComponents>;
    registerComponent: <Name extends string, Schema extends SchemaType>(
      def: ComponentDefinition<Name, Schema>
    ) => WorldBuilder<TComponents & { [K in Name]: z.infer<Schema> }>;
  };

export type GenericEntity<T extends Components> = {
  id: number;
  world: World<T>;
};

export type Entity<C extends keyof Components = never> = EntitySchema & {
  world: World<Components>;
} & {
  [K in C]-?: NonNullable<Components[K]>;
};

/**
 * Entity type for a world with specific components
 */
export type EntityWithComponents<
  TComponents extends Record<string, unknown>,
  C extends keyof TComponents = never
> = {
  id: number;
  world: World<TComponents>;
} & {
  [K in C]-?: TComponents[K] extends infer TData
    ? TData extends Record<string, unknown>
      ? TData
      : NonNullable<TComponents[K]>
    : NonNullable<TComponents[K]>;
};

export type EntitySchema = z.infer<typeof entitySchema>;
export const entitySchema = z
  .object({
    id: pkWithAutoIncrement()
  })
  .meta({ name: 'tbl_entity' });

export const getEntitySchema = () =>
  z
    .object({
      id: pkWithAutoIncrement()
    })
    .meta({ name: 'tbl_entity' });

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
