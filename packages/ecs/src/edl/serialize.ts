import { toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo, EntityWithComponents } from '../types';

type SerializableEntity =
  | EntityWithComponents<Record<string, unknown>>
  | {
      entity: EntityWithComponents<Record<string, unknown>>;
      name?: string;
    };

const normalizeIdentifier = (value: string): string => {
  const normalized = toSnakeCase(value);
  return normalized && normalized.length > 0 ? normalized : value;
};

const escapeString = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');

const formatQuotedString = (value: string): string =>
  `"${escapeString(value)}"`;

const ensureSerializableNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot serialize non-finite number: ${value}`);
  }
  return value.toString();
};

const BARE_WORD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const formatDefaultLiteral = (
  value: unknown,
  columnType: CDefColumnInfo['type']
): string => {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return ensureSerializableNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return formatQuotedString(value.toISOString());
  }
  if (typeof value === 'string') {
    if (BARE_WORD_PATTERN.test(value)) {
      return value;
    }
    return formatQuotedString(value);
  }
  if (Array.isArray(value) || typeof value === 'object') {
    if (columnType === 'json') {
      return JSON.stringify(value);
    }
    return formatQuotedString(JSON.stringify(value));
  }
  throw new TypeError(`Unsupported default value type: ${typeof value}`);
};

const formatValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    throw new TypeError('Cannot serialize undefined value to EDL');
  }
  if (typeof value === 'string') {
    if (value.startsWith('$')) {
      return value;
    }
    return formatQuotedString(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return ensureSerializableNumber(value);
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Cannot serialize bigint values to EDL');
  }
  if (value instanceof Date) {
    return formatQuotedString(value.toISOString());
  }
  if (Array.isArray(value)) {
    const items = value.map(formatValue);
    return `[${items.join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${normalizeIdentifier(k)}: ${formatValue(v)}`);
    return `{${entries.join(' ')}}`;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`Cannot serialize ${typeof value} values to EDL`);
  }
  return JSON.stringify(value);
};

const serializeComponentValue = (
  componentName: string,
  componentData: unknown
): string | null => {
  if (componentData === null || componentData === undefined) {
    return null;
  }
  const name = normalizeIdentifier(componentName);

  if (
    Array.isArray(componentData) ||
    typeof componentData !== 'object' ||
    componentData instanceof Date
  ) {
    return `  ${name} ${formatValue(componentData)}`;
  }

  const props = Object.entries(componentData as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) => `${normalizeIdentifier(key)}: ${formatValue(value)}`
    );

  if (props.length === 0) {
    return `  ${name} {}`;
  }

  return `  ${name} { ${props.join(' ')} }`;
};

const indentLines = (lines: string[]): string =>
  lines.map(line => (line.length > 0 ? `  ${line}` : '')).join('\n');

const formatColumn = (column: CDefColumnInfo): string => {
  const tokens: string[] = [];
  tokens.push(`${normalizeIdentifier(column.name)}: ${column.type}`);
  tokens.push(column.optional === false ? 'not null' : 'null');
  if (column.isUnique) {
    tokens.push('is_unique');
  }
  if (column.default !== undefined) {
    tokens.push(`default ${formatDefaultLiteral(column.default, column.type)}`);
  }
  return tokens.join(' ');
};

export const serializeComponentDef = (def: CDef): string => {
  const lines = def.columns.map(formatColumn);
  if (lines.length === 0) {
    return `def ${normalizeIdentifier(def.id)} {}`;
  }
  return `def ${normalizeIdentifier(def.id)} {\n${indentLines(lines)}\n}`;
};

export const serializeComponentDefs = (defs: readonly CDef[]): string =>
  defs.map(serializeComponentDef).join('\n\n');

const normalizeSerializableEntity = (
  value: SerializableEntity
): { entity: EntityWithComponents<Record<string, unknown>>; name?: string } => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'entity' in value &&
    (value as { entity: unknown }).entity &&
    typeof (value as { entity: unknown }).entity === 'object'
  ) {
    return value as {
      entity: EntityWithComponents<Record<string, unknown>>;
      name?: string;
    };
  }
  return { entity: value as EntityWithComponents<Record<string, unknown>> };
};

export const serializeEntity = (
  entity: EntityWithComponents<Record<string, unknown>>,
  name?: string
): string => {
  const entityName = name || `entity_${entity.id}`;

  const components = Object.entries(entity)
    .filter(
      ([componentKey]) => componentKey !== 'id' && componentKey !== 'world'
    )
    .sort(([a], [b]) =>
      normalizeIdentifier(a).localeCompare(normalizeIdentifier(b))
    )
    .map(([componentKey, componentData]) =>
      serializeComponentValue(componentKey, componentData)
    )
    .filter((value): value is string => Boolean(value));

  if (components.length === 0) {
    return `entity ${entityName} {}`;
  }

  return `entity ${entityName} {\n${components.join('\n')}\n}`;
};

export const serializeEntities = (
  entities: readonly SerializableEntity[]
): string =>
  entities
    .map(normalizeSerializableEntity)
    .map(({ entity, name }) => serializeEntity(entity, name))
    .join('\n\n');

export const serializeEDL = (options: {
  componentDefs?: readonly CDef[];
  entities?: readonly SerializableEntity[];
}): string => {
  const sections: string[] = [];

  if (options.componentDefs && options.componentDefs.length > 0) {
    sections.push(serializeComponentDefs(options.componentDefs));
  }

  if (options.entities && options.entities.length > 0) {
    sections.push(serializeEntities(options.entities));
  }

  return sections.join('\n\n');
};
