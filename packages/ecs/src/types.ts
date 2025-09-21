import type { CreateDatabaseOptions, DatabaseType, Statement } from '@db';
import type { World } from '@world';

import type { InferComponentType } from './component/types';
import type { ColumnInfo } from './schema/types';

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

// //////////////////////////////////////////////////////////////
// New Component Definition types
// //////////////////////////////////////////////////////////////

export type CDefColumnType =
  | 'string'
  | 'email'
  | 'enum'
  | 'int'
  | 'float'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'pk'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'array'
  | 'uuid';

export type CDefColumnInfo = {
  default?: string | number | boolean | Date;
  enum?: string[];
  foreignKey?: string;
  isIndexed?: boolean;
  isUnique?: boolean;
  name: string;
  optional?: boolean;
  type: CDefColumnType;
  values?: string[];
};

export type CDef = {
  columns: CDefColumnInfo[];
  hash: string;
  id: string;
  statements?: Record<string, string>;
};

// //////////////////////////////////////////////////////////////
// Old Component Definition types
// //////////////////////////////////////////////////////////////

export type ComponentDef = {
  columns: ColumnInfo[];
  name: string;
  schema: CDef; // Add schema to access defaults
  stmtInsert: Statement;
  stmtUpdate: Statement;
  tableName: string;
  url: string;
} & {
  [key: string]: Statement;
};

export type Components = Record<string, unknown>;

/**
 * World type that includes component types - now based on static world
 */
// export type World<TComponents extends Components> = {
//   close: () => void;
//   readonly componentTypes: (keyof TComponents)[];
//   db: Database;
//   defs: Map<string, ComponentDef>;
//   dirtyEntities: Map<number, Set<keyof TComponents>>;
//   entitiesToDelete: Set<number>;
//   entityCache: EntityCache<TComponents>;
//   flush: () => World<TComponents>;
//   stmts: Record<string, Statement>;
// };

// Helper type to extract component types from a World instance
export type ExtractWorldComponents<T> = T extends World<infer C> ? C : never;

export type GenericEntity<T extends Components> = {
  id: number;
  world: World<T>;
};

export type Entity<C extends keyof Components = never> = {
  id: number;
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

// Type helper for registering components dynamically
export type RegisterComponent<Name extends string, Schema extends CDef> = {
  [K in Name]: InferComponentType<Schema>;
};

// Static World Types - now just an alias for World (since World is now static)
export type StaticWorld<TComponents extends Components> = World<TComponents>;

// Helper type to infer component types from an array of component definitions
export type InferComponentsFromDefs<T extends readonly ComponentDefinition[]> =
  {
    [K in T[number] as K['name']]: InferComponentType<K['schema']>;
  };

// Helper type to infer component types directly from CDef arrays
export type InferComponentsFromCDefs<T extends readonly CDef[]> = {
  [K in T[number] as K['id']]: InferComponentType<K>;
};

// Tuple type for component definitions
export type ComponentDefinitionTuple<T extends Components> = {
  [K in keyof T]: ComponentDefinition;
}[keyof T][];

// Static world creation options
export type CreateStaticWorldOptions<T extends Components> = {
  components: ComponentDefinitionTuple<T>;
} & Partial<CreateDatabaseOptions> & {
    dbType?: DatabaseType;
  };
