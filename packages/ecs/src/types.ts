import { z } from 'zod';

import type {
  CreateDatabaseOptions,
  Database,
  DatabaseType,
  Statement
} from '@db';

import { pkWithAutoIncrement } from './schema';
import type { ColumnInfo, SchemaType } from './schema/types';

export type EntityId = number;

type ComponentCacheEntry<T> = {
  data: T;
  exists: boolean;
};

export type EntityCache<TWorldComponents extends Components> = Map<
  number,
  Partial<{
    [K in keyof TWorldComponents]: ComponentCacheEntry<TWorldComponents[K]>;
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
 * World type that includes component types - now based on static world
 */
export type World<TComponents extends Components> = {
  close: () => void;
  readonly componentTypes: keyof TComponents;
  db: Database;
  defs: Map<string, ComponentDef>;
  dirtyEntities: Map<number, Set<keyof TComponents>>;
  entitiesToDelete: Set<number>;
  entityCache: EntityCache<TComponents>;
  flush: () => World<TComponents>;
  registry: ReturnType<typeof z.registry>;
  stmts: Record<string, Statement>;
};


// Helper type to extract component types from a World instance
export type ExtractWorldComponents<T> = T extends World<infer C> ? C : never;

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
type ComponentData<T> = T extends Record<string, unknown> ? T : NonNullable<T>;

export type EntityWithComponents<
  TComponents extends Record<string, unknown>,
  C extends keyof TComponents = never
> = {
  id: number;
  world: World<TComponents>;
} & {
  // All components are available as optional properties for ergonomic reads/assignments
  [K in keyof TComponents]?: ComponentData<TComponents[K]>;
} & {
  // Components in C are known-present and therefore required
  [K in C]-?: ComponentData<TComponents[K]>;
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

// Static World Types - now just an alias for World (since World is now static)
export type StaticWorld<TComponents extends Components> = World<TComponents>;

// Helper type to infer component types from an array of component definitions
export type InferComponentsFromDefs<
  T extends readonly ComponentDefinition<string, SchemaType>[]
> = {
  [K in T[number] as K['name']]: z.infer<K['schema']>;
};

// Tuple type for component definitions
export type ComponentDefinitionTuple<T extends Components> = {
  [K in keyof T]: ComponentDefinition<K & string, SchemaType>;
}[keyof T][];

// Static world creation options
export type CreateStaticWorldOptions<T extends Components> = {
  components: ComponentDefinitionTuple<T>;
} & Partial<CreateDatabaseOptions> & {
    dbType?: DatabaseType;
  };
