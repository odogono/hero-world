import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo, CDefColumnType } from './types';

const pascalCase = (str: string): string =>
  (toSnakeCase(str) || str)
    .split('_')
    .filter(Boolean)
    .map(s => s[0]?.toUpperCase() + s.slice(1))
    .join('');

const zTypeFor = (t: CDefColumnType): string => {
  switch (t) {
    case 'pk':
    case 'int':
      return 'z.number().int()';
    case 'float':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'datetime':
    case 'timestamp':
      return 'z.iso.datetime()';
    case 'date':
      return 'z.date()';
    case 'email':
      return 'z.string().email()';
    case 'enum':
    case 'string':
    case 'time':
    case 'json':
    case 'array':
    default:
      return 'z.string()';
  }
};

const zEnum = (values?: string[]): string => {
  if (!values || values.length === 0) {
    return 'z.string()';
  }
  const vals = values
    .map(v => `'${v.replaceAll("'", String.raw`\'`)}'`)
    .join(', ');
  return `z.enum([${vals}])`;
};

const withDefault = (
  expr: string,
  def: unknown,
  type: CDefColumnType
): string => {
  if (def === undefined) {
    return expr;
  }
  if (typeof def === 'string') {
    const up = def.toUpperCase();
    if (
      up === 'CURRENT_TIMESTAMP' ||
      up === 'CURRENT TIME' ||
      up === 'CURRENT_DATE' ||
      up === 'CURRENT_TIME'
    ) {
      if (type === 'datetime' || type === 'timestamp') {
        return `${expr}.default(() => new Date().toISOString())`;
      }
      return `${expr}.default('${def.replaceAll("'", String.raw`\'`)}')`;
    }
    return `${expr}.default('${def.replaceAll("'", String.raw`\'`)}')`;
  }
  if (typeof def === 'number') {
    return `${expr}.default(${def})`;
  }
  if (typeof def === 'boolean') {
    return `${expr}.default(${def})`;
  }
  return `${expr}.default('${String(def).replaceAll("'", String.raw`\'`)}')`;
};

const withOptional = (expr: string, col: CDefColumnInfo): string => {
  const hasDefault = col.default !== undefined;
  const isEnum = col.type === 'enum';
  const required = col.optional === false || hasDefault || isEnum;
  return required ? expr : `${expr}.optional()`;
};

const withMeta = (expr: string, col: CDefColumnInfo): string => {
  const meta: Record<string, any> = {};
  if (col.isUnique) {
    meta.unique = true;
  }
  if (col.isIndexed) {
    meta.index = true;
  }
  if (col.isIndexed && col.isUnique) {
    meta.indexUnique = true;
  }
  const keys = Object.keys(meta);
  return keys.length ? `${expr}.meta(${JSON.stringify(meta)})` : expr;
};

const buildField = (col: CDefColumnInfo): string => {
  let base = '';
  if (col.type === 'enum') {
    base = zEnum(col.values);
  } else if (col.type === 'json') {
    base = 'z.json()';
  } else if (col.type === 'array') {
    base = 'z.array(z.any())';
  } else {
    base = zTypeFor(col.type);
  }

  base = withDefault(base, col.default, col.type);
  base = withOptional(base, col);
  base = withMeta(base, col);
  return base;
};

const autoFields = (): Record<string, string> => ({
  createdAt: 'z.iso.datetime().default(() => new Date().toISOString())',
  eid: 'z.number().int().optional()',
  id: 'z.number().int().optional()',
  updatedAt: 'z.iso.datetime().default(() => new Date().toISOString())'
});

export type CDefToZodInput = CDef | CDef[] | CDef[][];
export type CDefToZodOptions = { includeImports?: boolean };

const buildSingleSchema = (cdef: CDef): string => {
  const schemaName = `${pascalCase(cdef.id)}Schema`;
  const tableName = cdef.tableName || `tbl_${toSnakeCase(cdef.id) || cdef.id}`;

  const fields: Record<string, string> = { ...autoFields() };
  for (const col of cdef.columns) {
    const key = toCamelCase(col.name);
    if (fields[key]) continue;
    fields[key] = buildField(col);
  }

  const body = Object.entries(fields)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join(',\n');

  return `export const ${schemaName} = z.object({\n${body}\n}).meta({ name: '${tableName}' });\n`;
};

export const cdefToZod = (
  input: CDefToZodInput,
  options: CDefToZodOptions = {}
): string => {
  const includeImports = options.includeImports ?? true;
  const defs: CDef[] = Array.isArray(input)
    ? (input as any[]).flat(Infinity).filter(Boolean)
    : [input];

  const parts: string[] = [];
  if (includeImports) parts.push("import { z } from 'zod';\n");
  for (const d of defs) {
    parts.push(buildSingleSchema(d));
  }
  return parts.join('\n');
};
