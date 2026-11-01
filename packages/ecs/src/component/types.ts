import type { CDefColumnInfo, CDefColumnType } from '../types';

export type ColumnBuilder<
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

export type DefineComponentSchema = Record<
  string,
  ColumnBuilder<CDefColumnType, boolean>
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

export type ValueFromType<T> = T extends 'string' | 'email'
  ? string
  : T extends 'int' | 'float'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'datetime' | 'date' | 'time' | 'timestamp'
        ? Date
        : string | number | boolean;

export type OptionalKeysFromSchema<S extends DefineComponentSchema> = {
  [K in keyof S]: S[K] extends ColumnBuilder<CDefColumnType, true> ? K : never;
}[keyof S];
export type RequiredKeysFromSchema<S extends DefineComponentSchema> = Exclude<
  keyof S,
  OptionalKeysFromSchema<S>
>;

export type InferFromSchema<S extends DefineComponentSchema> = {
  [K in RequiredKeysFromSchema<S>]: S[K] extends ColumnBuilder<
    infer Type,
    boolean
  >
    ? ValueFromType<Type>
    : string | number | boolean;
} & {
  [K in OptionalKeysFromSchema<S>]?: S[K] extends ColumnBuilder<
    infer Type,
    boolean
  >
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
