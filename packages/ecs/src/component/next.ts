import type {
  CDef,
  CDefColumnInfo,
  CDefColumnType,
  Components,
  EntityWithComponents,
  GenericEntity,
  World
} from '@types';

import { makeTrackedComponent } from './helpers/make-tracked';
import { toTableName } from './helpers/to-table-name';

export const addComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName,
  data: TWorldComponents[TComponentName]
): EntityWithComponents<TWorldComponents, TComponentName> => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  // Check if component already exists and has been persisted
  const existingComponent =
    world.entityCache.get(id)?.[componentName as string];
  const isUpdate = existingComponent !== undefined && existingComponent.exists;

  // Apply default values from the component schema
  const dataWithDefaults = applyComponentDefaults(
    world,
    componentName as string,
    data
  );

  (entity as any)[componentName] = makeTrackedComponent(
    entity,
    componentName,
    dataWithDefaults,
    isUpdate // mark as existing if updating, new if adding
  ) as TWorldComponents[TComponentName];

  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);

  return entity as EntityWithComponents<TWorldComponents, TComponentName>;
};

export const addComponents = <
  TWorldComponents extends Components,
  TComponentData extends Partial<{
    [K in keyof TWorldComponents]: TWorldComponents[K];
  }>
>(
  entity: GenericEntity<TWorldComponents>,
  components: TComponentData
): EntityWithComponents<TWorldComponents, keyof TComponentData> => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  for (const [componentName, data] of Object.entries(components)) {
    // Apply default values from the component schema
    const dataWithDefaults = applyComponentDefaults(world, componentName, data);

    (entity as any)[componentName] = makeTrackedComponent(
      entity,
      componentName,
      dataWithDefaults,
      false // mark as new
    );

    if (!world.dirtyEntities.has(id)) {
      world.dirtyEntities.set(id, new Set());
    }
    world.dirtyEntities.get(id)!.add(componentName);
  }

  return entity as EntityWithComponents<TWorldComponents, keyof TComponentData>;
};

/**
 * Mark a component for deferred deletion (will be deleted on next flush)
 * This follows the same pattern as addComponent
 */
export const removeComponent = <
  TWorldComponents extends Components,
  TComponentName extends keyof TWorldComponents
>(
  entity: GenericEntity<TWorldComponents>,
  componentName: TComponentName
): void => {
  const { id, world } = entity;

  // Ensure id is defined
  if (id === undefined) {
    throw new Error('Entity ID is required');
  }

  // Mark component for deletion in cache
  const cache = world.entityCache.get(id);
  if (cache && cache[componentName as string]) {
    const cacheEntry = cache[componentName as string];
    cacheEntry.exists = false; // Mark as deleted
    cacheEntry.data = null; // Clear the data
  }

  // Remove from entity object
  delete (entity as any)[componentName];

  // Mark entity as dirty for this component
  if (!world.dirtyEntities.has(id)) {
    world.dirtyEntities.set(id, new Set());
  }
  world.dirtyEntities.get(id)!.add(componentName);
};

/**
 * Apply default values from a Zod schema to component data
 * This function merges the provided data with default values from the schema
 */
export const applyDefaults = <T>(
  schema: CDef,
  data: Partial<T>
): InferComponentType<typeof schema> => {
  const defaults = getDefaults(schema);

  // Merge defaults with provided data, with provided data taking precedence
  const merged = { ...defaults, ...data };

  // Validate the merged data against the schema
  return merged;
};

/**
 * Apply default values to component data using the world's component definitions
 * This function looks up the component schema and applies defaults
 */
export const applyComponentDefaults = <T extends Components>(
  world: World<T>,
  componentName: string,
  data: InferComponentType<T>
): InferComponentType<T> => {
  const def = world.defs.get(componentName);
  if (!def || !def.schema) {
    // If no schema found, return data as-is
    return data;
  }

  try {
    return applyDefaults(def.schema, data);
  } catch (error) {
    // If validation fails, log error and return data as-is
    console.warn(
      `Failed to apply defaults for component ${componentName}:`,
      error
    );
    return data;
  }
};

type ColumnBuilder<
  TType extends CDefColumnType,
  TOptional extends boolean = false
> = {
  readonly __optional?: TOptional;
  // Phantom type anchors for inference only
  readonly __type?: TType;
  build: (props: { name: string }) => CDefColumnInfo;
  default: (
    value?: string | number | boolean | undefined
  ) => ColumnBuilder<TType, TOptional>;
  foreignKey: (foreignKey: string) => ColumnBuilder<TType, TOptional>;
  indexed: () => ColumnBuilder<TType, TOptional>;
  optional: () => ColumnBuilder<TType, true>;
  unique: () => ColumnBuilder<TType, TOptional>;
};

type DefineComponentSchema = {
  [name: string]: ColumnBuilder<CDefColumnType, boolean>;
};

type DefineComponentProps<
  S extends DefineComponentSchema = DefineComponentSchema
> = {
  id: string;
  schema: S;
  statements?: Record<string, string>;
  tableName?: string;
};

type CDefWithSchema<S extends DefineComponentSchema> = CDef & { __schema: S };

type ValueFromType<T> = T extends 'string' | 'email'
  ? string
  : T extends 'int' | 'float'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'datetime' | 'date' | 'time' | 'timestamp'
        ? Date
        : string | number | boolean;

type OptionalKeysFromSchema<S extends DefineComponentSchema> = {
  [K in keyof S]: S[K] extends ColumnBuilder<any, true> ? K : never;
}[keyof S];
type RequiredKeysFromSchema<S extends DefineComponentSchema> = Exclude<
  keyof S,
  OptionalKeysFromSchema<S>
>;

type InferFromSchema<S extends DefineComponentSchema> = {
  [K in RequiredKeysFromSchema<S>]: S[K] extends ColumnBuilder<infer Type, any>
    ? ValueFromType<Type>
    : string | number | boolean;
} & {
  [K in OptionalKeysFromSchema<S>]?: S[K] extends ColumnBuilder<infer Type, any>
    ? ValueFromType<Type>
    : string | number | boolean;
};

export type InferComponentType<T> = T extends { __schema: infer S }
  ? S extends DefineComponentSchema
    ? InferFromSchema<S>
    : never
  : T extends { columns: infer C }
    ? C extends readonly unknown[]
      ? {
          // Required properties
          [K in C[number] as K extends { name: infer N; optional: true }
            ? never
            : K extends { name: infer N }
              ? N extends PropertyKey
                ? N
                : never
              : never]: K extends { type: infer Type }
            ? ValueFromType<Type>
            : string | number | boolean;
        } & {
          // Optional properties
          [K in C[number] as K extends { name: infer N; optional: true }
            ? N extends PropertyKey
              ? N
              : never
            : never]?: K extends { type: infer Type }
            ? ValueFromType<Type>
            : string | number | boolean;
        }
      : never
    : never;

export const defineComponent = <S extends DefineComponentSchema>(
  props: DefineComponentProps<S>
): CDefWithSchema<S> => {
  const { id, schema, statements, tableName: tableNameProp } = props;
  const tableName = toTableName(tableNameProp ?? id);

  const columns = Object.entries(schema).map(([name, schema]) =>
    schema.build({ name })
  );

  return {
    columns,
    id,
    statements,
    tableName
  } as CDefWithSchema<S>;
};

export const createComponent = <T extends CDef>(
  def: T,
  data: Partial<InferComponentType<T>> = {}
): InferComponentType<T> => {
  const defaults = getDefaults(def);
  return { ...defaults, ...data } as InferComponentType<T>;
};

/**
 * Get the default values for a component definition
 * @param def - The component definition
 * @returns The default values for the component
 */
export const getDefaults = (def: CDef) =>
  def.columns.reduce(
    (acc, column) => {
      if (column.default !== undefined) {
        // Convert sentinel strings to Date where applicable
        acc[column.name] = getDefaultForObject(column);
      } else if (!column.optional) {
        // Non-optional without explicit default gets a runtime default
        acc[column.name] = getDefault(column.type, true);
      }
      // Optional without default is omitted
      return acc;
    },
    {} as Record<string, string | number | boolean | Date>
  );

const getDefaultForObject = (
  column: CDefColumnInfo
): string | number | boolean | Date => {
  if (column.default !== undefined) {
    if (
      typeof column.default === 'string' &&
      (column.default === 'current_timestamp' ||
        column.default === 'current_date' ||
        column.default === 'current_time')
    ) {
      return getDefault(column.type, true);
    }
    return column.default;
  }
  return getDefault(column.type, true);
};

const columnBuilder = <TType extends CDefColumnType>(
  type: TType
): ColumnBuilder<TType, false> => {
  const column: CDefColumnInfo = {
    name: 'unknown',
    optional: false,
    type
  };

  const builder: ColumnBuilder<TType, false> = {
    build: (props: { name: string }) => {
      column.name = props.name;
      return column;
    },
    default: (
      value?:
        | string
        | number
        | boolean
        | Array<string | number | boolean>
        | undefined
    ) => {
      column.default = value === undefined ? getDefault(column.type) : value;
      return builder;
    },
    foreignKey: (foreignKey: string) => {
      column.foreignKey = foreignKey;
      return builder;
    },
    indexed: () => {
      column.isIndexed = true;
      return builder;
    },
    optional: () => {
      column.optional = true;
      return builder as unknown as ColumnBuilder<TType, true>;
    },
    unique: () => {
      column.isUnique = true;
      return builder;
    }
  };

  return builder;
};

const array = (type: CDefColumnType) => columnBuilder('array');
const boolean = () => columnBuilder('boolean');
const date = () => columnBuilder('date');
const datetime = () => columnBuilder('datetime');
const email = () => columnBuilder('email');
const entityId = () => columnBuilder('int').optional().foreignKey('tbl_entity');
const enumBuilder = (values: string[]) => columnBuilder('enum');
const float = () => columnBuilder('float');
const int = () => columnBuilder('int');
const json = () => columnBuilder('json');
const now = () => 'current_timestamp';
const number = () => columnBuilder('float');
const pk = () => columnBuilder('pk');
const string = () => columnBuilder('string');
const time = () => columnBuilder('time');
const timestamp = () => columnBuilder('timestamp');

export const s = {
  array,
  boolean,
  date,
  datetime,
  email,
  entityId,
  enum: enumBuilder,
  float,
  int,
  json,
  now,
  number,
  pk,
  string,
  time,
  timestamp
};

const getDefault = (type: CDefColumnType, forObject: boolean = false) => {
  switch (type) {
    case 'array':
      return [];
    case 'enum':
      return '';
    case 'string':
    case 'email':
      return '';
    case 'int':
      return 0;
    case 'float':
      return 0.0;
    case 'boolean':
      return false;
    case 'datetime':
      return forObject ? new Date() : 'current_timestamp';
    case 'date':
      return forObject ? new Date() : 'current_date';
    case 'time':
      return forObject ? new Date() : 'current_time';
    case 'timestamp':
      return forObject ? new Date() : 'current_timestamp';
    default:
      return '';
  }
};
