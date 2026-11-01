import type { CDefColumnInfo, CDefColumnType } from '../types';

export type ColumnBuilder<
  TType extends CDefColumnType,
  TOptional extends boolean = false,
  TValue = ValueFromType<TType>,
  TDefault extends boolean = false
> = {
  // Phantom type anchors for inference only
  readonly __default?: TDefault;
  readonly __optional?: TOptional;
  readonly __type?: TType;
  readonly __value?: TValue;
  build: (props: { name: string }) => CDefColumnInfo;
  default: (value?: unknown) => ColumnBuilder<TType, TOptional, TValue, true>;
  foreignKey: (
    foreignKey: string
  ) => ColumnBuilder<TType, TOptional, TValue, TDefault>;
  indexed: () => ColumnBuilder<TType, TOptional, TValue, TDefault>;
  optional: () => ColumnBuilder<TType, true, TValue, TDefault>;
  unique: () => ColumnBuilder<TType, TOptional, TValue, TDefault>;
};

/**
 * A type-only key on an inferred component type that holds the shape
 * `world.create` accepts for it: fields with a default may be left out.
 */
export declare const COMPONENT_INPUT: unique symbol;

/** What `world.create` accepts for a component of type `T`. */
export type ComponentInput<T> = T extends {
  readonly [COMPONENT_INPUT]?: infer I;
}
  ? I
  : T;

export type DefineComponentSchema = Record<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any value type
  ColumnBuilder<CDefColumnType, boolean, any, boolean>
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
  [K in keyof S]: S[K] extends { readonly __optional?: true } ? K : never;
}[keyof S];

/** Keys `world.create` may leave out: optional, or with a default */
type InputOptionalKeysFromSchema<S extends DefineComponentSchema> = {
  [K in keyof S]: S[K] extends { readonly __optional?: true }
    ? K
    : S[K] extends { readonly __default?: true }
      ? K
      : never;
}[keyof S];

type ValueOf<B> = B extends { readonly __value?: infer Value }
  ? Value
  : unknown;

type InferInputFromSchema<S extends DefineComponentSchema> = {
  [K in Exclude<keyof S, InputOptionalKeysFromSchema<S>>]: ValueOf<S[K]>;
} & {
  [K in InputOptionalKeysFromSchema<S>]?: ValueOf<S[K]>;
};
export type RequiredKeysFromSchema<S extends DefineComponentSchema> = Exclude<
  keyof S,
  OptionalKeysFromSchema<S>
>;

export type InferFromSchema<S extends DefineComponentSchema> = {
  [K in RequiredKeysFromSchema<S>]: ValueOf<S[K]>;
} & {
  [K in OptionalKeysFromSchema<S>]?: ValueOf<S[K]>;
} & {
  readonly [COMPONENT_INPUT]?: InferInputFromSchema<S>;
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
