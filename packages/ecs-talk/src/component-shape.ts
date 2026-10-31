import type { CDef, CDefColumnInfo } from 'odgn-ecs/types';
import { toCamelCase } from 'odgn-helpers/string';
import { z } from 'zod';

import { shape, type FieldShape, type Shape } from '@northtalk/ts';

/** The Script-facing Shape and the Zod validator for one component */
export type ComponentShape = {
  /** the component's columns, without the id/eid bookkeeping columns */
  columns: CDefColumnInfo[];
  /** the data key (camelCase) of each column, in column order */
  keys: string[];
  /** `{optional: map}`: Nothing when the entity lacks the component */
  shape: Shape;
  validator: z.ZodType<Record<string, unknown>>;
};

const isBookkeeping = (col: CDefColumnInfo) =>
  col.name === 'id' || col.name === 'eid';

/** a column may be left out of a set when it is optional or has a default */
const isOmittable = (col: CDefColumnInfo) =>
  col.optional === true || col.default !== undefined;

const columnShape = (col: CDefColumnInfo): Shape => {
  switch (col.type) {
    case 'int':
    case 'float':
    case 'pk': {
      return shape.number;
    }
    case 'boolean': {
      return shape.bool;
    }
    case 'json':
    case 'array': {
      return shape.any;
    }
    default: {
      return shape.text;
    }
  }
};

const columnZod = (col: CDefColumnInfo): z.ZodType => {
  let schema: z.ZodType;
  if (col.enum && col.enum.length > 0) {
    schema = z.enum(col.enum as [string, ...string[]]);
  } else {
    switch (col.type) {
      case 'int':
      case 'pk': {
        schema = z.number().int();
        break;
      }
      case 'float': {
        schema = z.number();
        break;
      }
      case 'boolean': {
        schema = z.boolean();
        break;
      }
      case 'array': {
        schema = z.array(z.unknown());
        break;
      }
      case 'json': {
        schema = z.unknown();
        break;
      }
      default: {
        schema = z.string();
      }
    }
  }
  return isOmittable(col) ? schema.nullish() : schema;
};

/** Derive a component's Shape and validator from its definition */
export const toComponentShape = (def: CDef): ComponentShape => {
  const columns = def.columns.filter(col => !isBookkeeping(col));

  const fields: Record<string, FieldShape> = {};
  const zodFields: Record<string, z.ZodType> = {};
  const keys = columns.map(col => toCamelCase(col.name) || col.name);
  columns.forEach((col, ii) => {
    const key = keys[ii]!;
    const field = columnShape(col);
    fields[key] = isOmittable(col)
      ? { optional: true, shape: shape.optional(field) }
      : field;
    zodFields[key] = columnZod(col);
  });

  return {
    columns,
    keys,
    shape: shape.optional(shape.map(fields)),
    validator: z.strictObject(zodFields) as unknown as z.ZodType<
      Record<string, unknown>
    >
  };
};
