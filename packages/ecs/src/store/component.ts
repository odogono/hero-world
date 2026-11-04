/**
 * A component definition as the World stores it: a name and typed columns,
 * kept in `ecs_components` and held in a table `c_<name>`, one row per
 * entity. This is the shared World layout that `odgn_ecs` (Elixir) also
 * reads and writes (ADR 0019), so names, types and the stored JSON follow
 * `OdgnEcs.Component` and `OdgnEcs.Column` exactly.
 */
import { StoreError } from './error';

export const COLUMN_TYPES = [
  'string',
  'email',
  'enum',
  'datetime',
  'date',
  'time',
  'timestamp',
  'int',
  'float',
  'boolean',
  'eid',
  'json',
  'array'
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

export const ON_DELETE = ['restrict', 'nullify', 'cascade'] as const;

/** What deleting the entity an `eid` column refers to does */
export type OnDelete = (typeof ON_DELETE)[number];

export type Column = {
  caseInsensitive: boolean;
  default: unknown;
  index: boolean;
  name: string;
  onDelete: OnDelete;
  optional: boolean;
  type: ColumnType;
  unique: boolean;
};

export type Component = {
  columns: Column[];
  name: string;
  playState: boolean;
};

export type ColumnInput = Partial<Omit<Column, 'name' | 'type'>> & {
  name: string;
  type: ColumnType;
};

/** A column with every unstated option at its default, as `odgn_ecs` has */
export const column = (input: ColumnInput): Column => ({
  caseInsensitive: input.caseInsensitive ?? false,
  default: input.default ?? null,
  index: input.index ?? false,
  name: input.name,
  onDelete: input.onDelete ?? 'restrict',
  optional: input.optional ?? true,
  type: input.type,
  unique: input.unique ?? false
});

export const component = (
  name: string,
  columns: ColumnInput[],
  playState = false
): Component => ({ columns: columns.map(column), name, playState });

const RESERVED = new Set(['id', 'eid']);
const TIME_NOW = new Set(['current_timestamp', 'current_date', 'current_time']);
const IDENTIFIER = /^[A-Z_a-z]\w*$/;

/** Quotes an identifier */
export const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const tableName = (c: Component | string) =>
  `c_${typeof c === 'string' ? c : c.name}`;

/** Checks a definition before it is stored */
const fail = (message: string, code = 'invalid_component'): never => {
  throw new StoreError(code, message);
};

export const validate = (c: Component) => {
  if (!IDENTIFIER.test(c.name)) {
    fail(`Component name '${c.name}' is not an identifier.`);
  }
  const names = new Set<string>();
  for (const col of c.columns) {
    if (RESERVED.has(col.name)) {
      fail(
        `Component '${c.name}' cannot define reserved column '${col.name}'.`,
        'reserved_column'
      );
    }
    if (!IDENTIFIER.test(col.name)) {
      fail(`Component '${c.name}' column '${col.name}' is not an identifier.`);
    }
    if (!COLUMN_TYPES.includes(col.type)) {
      fail(
        `Component '${c.name}' column '${col.name}' has unknown type '${col.type}'.`
      );
    }
    if (!ON_DELETE.includes(col.onDelete)) {
      fail(
        `Component '${c.name}' column '${col.name}' has unknown on_delete '${col.onDelete}'.`
      );
    }
    if (names.has(col.name)) {
      fail(`Component '${c.name}' defines a column twice.`);
    }
    names.add(col.name);
  }
};

const sqlType = (type: ColumnType) =>
  type === 'int' || type === 'eid' || type === 'boolean'
    ? 'INTEGER'
    : type === 'float'
      ? 'REAL'
      : 'TEXT';

const SQL_ACTION: Record<OnDelete, string> = {
  cascade: 'CASCADE',
  nullify: 'SET NULL',
  restrict: 'RESTRICT'
};

export const sqlColumn = (col: Column) =>
  `${ident(col.name)} ${sqlType(col.type)}${col.caseInsensitive ? ' COLLATE NOCASE' : ''}`;

export const createSql = (c: Component, table = tableName(c)) => {
  const cols = c.columns.map(
    col =>
      sqlColumn(col) +
      (col.unique ? ' UNIQUE' : '') +
      (col.type === 'eid'
        ? ` REFERENCES entities(eid) ON DELETE ${SQL_ACTION[col.onDelete]}`
        : '')
  );
  return `CREATE TABLE ${ident(table)} (${[
    'eid INTEGER PRIMARY KEY REFERENCES entities(eid) ON DELETE CASCADE',
    ...cols
  ].join(', ')})`;
};

/** The foreign keys the table should have, as `PRAGMA foreign_key_list` gives them */
export const foreignKeys = (c: Component): Set<string> =>
  new Set([
    'eid CASCADE',
    ...c.columns
      .filter(col => col.type === 'eid')
      .map(col => `${col.name} ${SQL_ACTION[col.onDelete]}`)
  ]);

/**
 * Triggers that delete an entity holding a `cascade` Reference to one being
 * deleted, and drop those of any other column, so it can run on every
 * definition
 */
export const cascadeSql = (c: Component) => {
  const table = tableName(c);
  return c.columns
    .map(col => {
      const trigger = ident(`t_${table}_${col.name}`);
      return col.type === 'eid' && col.onDelete === 'cascade'
        ? `CREATE TRIGGER IF NOT EXISTS ${trigger} BEFORE DELETE ON entities BEGIN ` +
            `DELETE FROM entities WHERE eid IN ` +
            `(SELECT eid FROM ${ident(table)} WHERE ${ident(col.name)} = OLD.eid); END;`
        : `DROP TRIGGER IF EXISTS ${trigger};`;
    })
    .join(' ');
};

const indexed = (col: Column) =>
  col.unique ? false : col.type === 'eid' ? true : col.index;

/** Gives each indexed column an index, and drops the index of any other */
export const indexSql = (c: Component) => {
  const table = tableName(c);
  return c.columns
    .map(col => {
      const index = ident(`i_${table}_${col.name}`);
      return indexed(col)
        ? `CREATE INDEX IF NOT EXISTS ${index} ON ${ident(table)} (${ident(col.name)});`
        : `DROP INDEX IF EXISTS ${index};`;
    })
    .join(' ');
};

export type Change =
  | { col: Column; kind: 'add' }
  | { col: Column; kind: 'fill' }
  | { kind: 'drop'; name: string }
  | { kind: 'rebuild' };

/**
 * How the table of `existing` changes to hold `next`, or throws an
 * `incompatible_change` error; see `OdgnEcs.Component.changes/2`.
 */
export const changes = (existing: Component, next: Component): Change[] => {
  const oldBy = new Map(existing.columns.map(c => [c.name, c]));
  const newNames = new Set(next.columns.map(c => c.name));
  const name = next.name;
  const out: Change[] = [];
  for (const col of next.columns) {
    const old = oldBy.get(col.name);
    if (!old) {
      if (col.unique) {
        fail(
          `Component '${name}' can't add unique column '${col.name}'.`,
          'incompatible_change'
        );
      }
      if (!col.optional && col.default === null) {
        fail(
          `Component '${name}' can't add required column '${col.name}' with no default.`,
          'incompatible_change'
        );
      }
      out.push({ col, kind: 'add' });
    } else if (old.type !== col.type) {
      fail(
        `Component '${name}' column '${col.name}' can't change type from ${old.type} to ${col.type}.`,
        'incompatible_change'
      );
    } else if (
      old.unique !== col.unique ||
      old.caseInsensitive !== col.caseInsensitive
    ) {
      out.push({ kind: 'rebuild' });
    } else if (old.optional && !col.optional && col.default === null) {
      fail(
        `Component '${name}' column '${col.name}' can't become required with no default.`,
        'incompatible_change'
      );
    } else if (old.optional && !col.optional) {
      out.push({ col, kind: 'fill' });
    }
  }
  for (const c of existing.columns) {
    if (!newNames.has(c.name)) {
      out.push({ kind: 'drop', name: c.name });
    }
  }
  return out;
};

// -- Values -------------------------------------------------------------------

const now = (d: string) => {
  const iso = new Date().toISOString();
  return d === 'current_date'
    ? iso.slice(0, 10)
    : d === 'current_time'
      ? iso.slice(11, 23)
      : iso;
};

const defaultOf = (col: Column) =>
  typeof col.default === 'string' && TIME_NOW.has(col.default)
    ? now(col.default)
    : col.default;

const describe = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const encodeValue = (name: string, col: Column, v: unknown): unknown => {
  if (v === null || v === undefined) {
    if (!col.optional) {
      throw new StoreError(
        'missing_value',
        `Component '${name}' needs a value for '${col.name}'.`
      );
    }
    return null;
  }
  const bad = () =>
    new StoreError(
      'invalid_value',
      `Component '${name}' '${col.name}' must be ${col.type}, not ${describe(v)}.`
    );
  switch (col.type) {
    case 'int':
    case 'eid':
      if (typeof v === 'number' && Number.isInteger(v)) {
        return v;
      }
      throw bad();
    case 'float':
      if (typeof v === 'number') {
        return v;
      }
      throw bad();
    case 'boolean':
      if (typeof v === 'boolean') {
        return v ? 1 : 0;
      }
      throw bad();
    case 'json':
      return JSON.stringify(v);
    case 'array':
      if (Array.isArray(v)) {
        return JSON.stringify(v);
      }
      throw bad();
    default:
      if (typeof v === 'string') {
        return v;
      }
      throw bad();
  }
};

/** A column's default, as stored */
export const storedDefault = (c: Component, col: Column) =>
  encodeValue(c.name, { ...col, optional: true }, defaultOf(col));

/**
 * The component's values for `data`, in column order, ready to store:
 * defaults filled in and every value checked against its column.
 */
export const encode = (c: Component, data: unknown): unknown[] => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new StoreError(
      'invalid_value',
      `Component '${c.name}' data must be a map.`
    );
  }
  const record = data as Record<string, unknown>;
  const known = new Set(c.columns.map(col => col.name));
  const unknown = Object.keys(record).find(k => !known.has(k));
  if (unknown !== undefined) {
    throw new StoreError(
      'unknown_property',
      `Component '${c.name}' has no property '${unknown}'.`
    );
  }
  return c.columns.map(col =>
    encodeValue(
      c.name,
      col,
      col.name in record && record[col.name] !== undefined
        ? record[col.name]
        : defaultOf(col)
    )
  );
};

/** One value of a column, as it is compared in a query */
export const queryValue = (col: Column, v: unknown) =>
  col.type === 'boolean' && typeof v === 'boolean'
    ? v
      ? 1
      : 0
    : (col.type === 'json' || col.type === 'array') &&
        v !== null &&
        v !== undefined
      ? JSON.stringify(v)
      : (v ?? null);

const decodeValue = (type: ColumnType, v: unknown) =>
  v === null || v === undefined
    ? null
    : type === 'boolean'
      ? v === 1 || v === 1n
      : type === 'json' || type === 'array'
        ? JSON.parse(v as string)
        : typeof v === 'bigint'
          ? Number(v)
          : v;

export const decode = (c: Component, values: unknown[]) =>
  Object.fromEntries(
    c.columns.map((col, i) => [col.name, decodeValue(col.type, values[i])])
  ) as Record<string, unknown>;

// -- Stored JSON ----------------------------------------------------------------

/**
 * The definition as `ecs_components.columns` holds it. Keys are sorted, as
 * Elixir's JSON encoder writes them, so both implementations store the same
 * text.
 */
export const toJSON = (c: Component) =>
  JSON.stringify({
    columns: c.columns.map(col => ({
      case_insensitive: col.caseInsensitive,
      default: col.default,
      index: col.index,
      name: col.name,
      on_delete: col.onDelete,
      optional: col.optional,
      type: col.type,
      unique: col.unique
    })),
    play_state: c.playState
  });

type StoredColumn = {
  case_insensitive?: boolean;
  default?: unknown;
  index?: boolean;
  name: string;
  on_delete?: OnDelete;
  optional: boolean;
  type: ColumnType;
  unique: boolean;
};

export const fromJSON = (name: string, json: string): Component => {
  const parsed = JSON.parse(json) as
    StoredColumn[] | { columns: StoredColumn[]; play_state?: boolean };
  // Definitions stored before `play_state` are a bare list of columns
  const [stored, playState] = Array.isArray(parsed)
    ? [parsed, false]
    : [parsed.columns, parsed.play_state === true];
  return {
    columns: stored.map(c => ({
      caseInsensitive: c.case_insensitive === true,
      default: c.default ?? null,
      index: c.index === true,
      name: c.name,
      onDelete: c.on_delete ?? 'restrict',
      optional: c.optional,
      type: c.type,
      unique: c.unique
    })),
    name,
    playState
  };
};
