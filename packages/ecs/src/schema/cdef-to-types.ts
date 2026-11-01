import { toCamelCase, toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo, CDefColumnType } from '../types';

const pascalCase = (str: string): string =>
  (toSnakeCase(str) || str)
    .split('_')
    .filter(Boolean)
    .map(s => s[0]?.toUpperCase() + s.slice(1))
    .join('');

const tsTypeFor = (t: CDefColumnType, values?: string[]): string => {
  switch (t) {
    case 'pk':
    case 'int':
    case 'float':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
    case 'timestamp':
    case 'time':
    case 'email':
    case 'string':
      return 'string';
    case 'date':
      return 'Date';
    case 'json':
      return 'unknown';
    case 'array':
      return 'unknown[]';
    case 'enum': {
      if (!values || values.length === 0) {
        return 'string';
      }
      const lit = values
        .map(v => `'${v.replaceAll("'", String.raw`\'`)}'`)
        .join(' | ');
      return lit;
    }
    default:
      return 'string';
  }
};

const isRequired = (col: CDefColumnInfo): boolean => {
  const hasDefault = col.default !== undefined;
  const isEnum = col.type === 'enum';
  return col.optional === false || hasDefault || isEnum;
};

const buildFieldLine = (col: CDefColumnInfo): string => {
  const key = toCamelCase(col.name);
  const optional = isRequired(col) ? '' : '?';
  const tsType = tsTypeFor(col.type, col.values);
  return `  ${key}${optional}: ${tsType};`;
};

const autoFieldLines = (): string[] => [
  '  id?: number;',
  '  eid?: number;',
  '  createdAt: string;',
  '  updatedAt: string;'
];

export type CDefToTypesInput = CDef | CDef[] | CDef[][];

const buildSingleType = (cdef: CDef): { name: string; typeBlock: string } => {
  const componentName = `${pascalCase(cdef.id)}Component`;
  const seen = new Set<string>();

  const lines: string[] = [];
  for (const l of autoFieldLines()) {
    const k = l.trim().split(':')[0]?.replace('?', '').trim();
    if (k) {
      seen.add(k);
    }
    lines.push(l);
  }

  for (const col of cdef.columns) {
    const key = toCamelCase(col.name);
    if (seen.has(key)) {
      continue;
    }
    lines.push(buildFieldLine(col));
    seen.add(key);
  }

  const block = `export type ${componentName} = {\n${lines.join('\n')}\n};\n`;
  return { name: componentName, typeBlock: block };
};

export const cdefToTypes = (input: CDefToTypesInput): string => {
  const defs: CDef[] = Array.isArray(input)
    ? ((input as CDef[][]).flat(Infinity).filter(Boolean) as CDef[])
    : [input];

  const parts: string[] = [];
  const names: string[] = [];

  for (const d of defs) {
    const { name, typeBlock } = buildSingleType(d);
    names.push(name);
    parts.push(typeBlock);
  }

  // Union type for all components
  if (names.length > 0) {
    parts.push(
      '// Union type for all components',
      `export type AllComponents =\n  | ${names.join('\n  | ')};`,
      '',
      '// Components type for ECS World type inference',
      'export type Components = {'
    );
    for (const d of defs) {
      const camel = toCamelCase(d.id);
      const pascal = pascalCase(d.id);
      parts.push(`  ${camel}: ${pascal}Component;`);
    }
    parts.push('};');
  }

  return parts.join('\n');
};
