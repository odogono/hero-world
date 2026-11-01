import type { CDefColumnInfo, CDefColumnType } from '../types';

export type ColumnBuilder<
  TType extends CDefColumnType,
  TOptional extends boolean = false,
  TValue = ValueFromType<TType>
> = {
  readonly __optional?: TOptional;
  // Phantom type anchors for inference only
  readonly __type?: TType;
  readonly __value?: TValue;
  build: (props: { name: string }) => CDefColumnInfo;
  default: (value?: unknown) => ColumnBuilder<TType, TOptional, TValue>;
  foreignKey: (foreignKey: string) => ColumnBuilder<TType, TOptional, TValue>;
  indexed: () => ColumnBuilder<TType, TOptional, TValue>;
  optional: () => ColumnBuilder<TType, true, TValue>;
  unique: () => ColumnBuilder<TType, TOptional, TValue>;
};

export type DefineComponentSchema = Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any value type
  ColumnBuilder<CDefColumnType, boolean, any>
>;

export type DefineComponentProps<
  S extends DefineComponentSchema,
  Name extends string
> = {
  id: Name;
  schema: S;
  statements?: Record<string, string>;
  tableName?: string;
};

/**
 * The value a column holds, as read back from the database: `datetime` is
 * parsed into a Date, `json` and `array` are parsed from JSON, and `date`
 * and `time` stay the strings they were stored as.
 */
export type ValueFromType<T> = T extends
  'string' | 'email' | 'enum' | 'uuid' | 'date' | 'time'
  ? string
  : T extends 'int' | 'float' | 'pk' | 'timestamp'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'datetime'
        ? Date
        : T extends 'array'
          ? unknown[]
          : unknown;

export type OptionalKeysFromSchema<S extends DefineComponentSchema> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any value type
  [K in keyof S]: S[K] extends ColumnBuilder<CDefColumnType, true, any>
    ? K
    : never;
}[keyof S];
export type RequiredKeysFromSchema<S extends DefineComponentSchema> = Exclude<
  keyof S,
  OptionalKeysFromSchema<S>
>;

export type InferFromSchema<S extends DefineComponentSchema> = {
  [K in RequiredKeysFromSchema<S>]: S[K] extends ColumnBuilder<
    CDefColumnType,
    boolean,
    infer Value
  >
    ? Value
    : unknown;
} & {
  [K in OptionalKeysFromSchema<S>]?: S[K] extends ColumnBuilder<
    CDefColumnType,
    boolean,
    infer Value
  >
    ? Value
    : unknown;
};

export type InferComponentType<T> = T extends { __schema: infer S }
  ? S extends DefineComponentSchema
    ? InferFromSchema<S>
    : never
  : T extends { columns: infer C }
    ? C extends readonly unknown[]
      ? {
          // Required properties
          [
            K in C[number] as K extends { name: infer N; optional: true }
              ? never
              : K extends { name: infer N }
                ? N extends PropertyKey
                  ? N
                  : never
                : never
          ]: K extends { type: infer Type }
            ? ValueFromType<Type>
            : string | number | boolean;
        } & {
          // Optional properties
          [
            K in C[number] as K extends { name: infer N; optional: true }
              ? N extends PropertyKey
                ? N
                : never
              : never
          ]?: K extends { type: infer Type }
            ? ValueFromType<Type>
            : string | number | boolean;
        }
      : never
    : never;
