import { toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo, CDefColumnType } from '@types';

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
  const { id, schema, tableName: tableNameProp } = props;
  const tableName = toTableName(tableNameProp ?? id);

  const columns = Object.entries(schema).map(([name, schema]) =>
    schema.build({ name })
  );

  return {
    columns,
    id,
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
    default: (value?: string | number | boolean | undefined) => {
      column.default = value === undefined ? getDefault(column.type) : value;
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

export const email = () => columnBuilder('email');
export const string = () => columnBuilder('string');
export const int = () => columnBuilder('int');
export const float = () => columnBuilder('float');
export const boolean = () => columnBuilder('boolean');
export const datetime = () => columnBuilder('datetime');
export const date = () => columnBuilder('date');
export const time = () => columnBuilder('time');
export const timestamp = () => columnBuilder('timestamp');
export const json = () => columnBuilder('json');
export const array = () => columnBuilder('array');
export const now = () => 'current_timestamp';

const getDefault = (type: CDefColumnType, forObject: boolean = false) => {
  switch (type) {
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

const toTableName = (id: string) => {
  if (id.startsWith('tbl_')) {
    id = id.slice(4);
  }
  return `tbl_${toSnakeCase(id)}`;
};
