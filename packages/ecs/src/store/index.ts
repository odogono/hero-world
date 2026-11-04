/**
 * The entity-component store: the shared World layout over one SQLite
 * database, at parity with `odgn_ecs` (ADR 0019). A World file written here
 * opens in `odgn_ecs`, and one written there opens here.
 *
 * - `entities (eid INTEGER PRIMARY KEY)`: every entity.
 * - `ecs_components (name, columns)`: each Component Definition, as JSON.
 * - `c_<name>`: one table per definition, one typed column per property and
 *   one row per entity that has it.
 *
 * The functions here write straight to the database. `World` keeps pending
 * changes and proxies on top of them, and writes through these on flush.
 */
import type { Database } from '../db';
import {
  cascadeSql,
  changes,
  createSql,
  decode,
  encode,
  foreignKeys,
  fromJSON,
  ident,
  indexSql,
  queryValue,
  sqlColumn,
  storedDefault,
  tableName,
  toJSON,
  validate,
  type Column,
  type Component
} from './component';
import { StoreError } from './error';

export * from './component';
export { StoreError } from './error';

export type Eid = number;
export type Data = Record<string, unknown>;

export const SCHEMA = `CREATE TABLE IF NOT EXISTS entities (eid INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS ecs_components (name TEXT PRIMARY KEY, columns TEXT NOT NULL);`;

export type Store = {
  components: Map<string, Component>;
  db: Database;
};

const all = <T = Record<string, unknown>>(
  db: Database,
  sql: string,
  args?: unknown[]
) => (args && args.length > 0 ? db.query(sql, args) : db.query(sql)) as T[];

/**
 * Opens the store over `db`, making its tables if they're missing, with the
 * components already defined in it.
 */
export const openStore = (db: Database): Store => {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA recursive_triggers = ON');
  db.exec(SCHEMA);
  const components = new Map<string, Component>();
  for (const { columns, name } of all<{ columns: string; name: string }>(
    db,
    'SELECT name, columns FROM ecs_components'
  )) {
    components.set(name, fromJSON(name, columns));
  }
  return { components, db };
};

// -- Savepoints -------------------------------------------------------------

/**
 * Runs `fn` inside a savepoint: released if it returns, rolled back if it
 * throws.
 */
export const inSavepoint = <T>(store: Store, name: string, fn: () => T): T => {
  const sp = ident(name);
  store.db.exec(`SAVEPOINT ${sp}`);
  const before = new Map(store.components);
  try {
    const result = fn();
    store.db.exec(`RELEASE ${sp}`);
    return result;
  } catch (error) {
    store.db.exec(`ROLLBACK TO ${sp}`);
    store.db.exec(`RELEASE ${sp}`);
    store.components.clear();
    for (const [k, v] of before) {
      store.components.set(k, v);
    }
    throw error;
  }
};

// -- Components ---------------------------------------------------------------

const sameDefinition = (a: Component, b: Component) => toJSON(a) === toJSON(b);

/**
 * Defines a component, creating its table. Defining one the store already
 * has is fine if the definition is the same. If it differs, compatible
 * changes are made to the table in place, and any other throws an
 * `incompatible_change` error (see `changes`).
 */
export const define = (store: Store, c: Component): Component => {
  validate(c);
  inSavepoint(store, 'odgn_ecs_define', () => {
    defineTable(store, c);
    ensureKeys(store, c);
    // Every time, so a World made before a column was indexed or cascaded
    // gets its index or trigger
    store.db.exec(indexSql(c));
    store.db.exec(cascadeSql(c));
  });
  return store.components.get(c.name)!;
};

const defineTable = (store: Store, c: Component) => {
  const { db } = store;
  const row = all<{ columns: string }>(
    db,
    'SELECT columns FROM ecs_components WHERE name = ?1',
    [c.name]
  )[0];
  const existing = row ? fromJSON(c.name, row.columns) : undefined;
  if (!existing) {
    db.exec(createSql(c));
    db.exec('INSERT INTO ecs_components (name, columns) VALUES (?1, ?2)', [
      c.name,
      toJSON(c)
    ]);
    store.components.set(c.name, c);
    return;
  }
  if (sameDefinition(existing, c)) {
    store.components.set(c.name, existing);
    return;
  }
  changeTable(store, existing, c);
};

const changeTable = (store: Store, existing: Component, c: Component) => {
  const { db } = store;
  const table = ident(tableName(c));
  const steps = changes(existing, c);
  for (const step of steps) {
    switch (step.kind) {
      case 'add':
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${sqlColumn(step.col)}`);
        fill(store, c, step.col, '');
        break;
      case 'fill':
        fill(store, c, step.col, ` WHERE ${ident(step.col.name)} IS NULL`);
        break;
      case 'drop':
        // SQLite won't drop an indexed column
        db.exec(
          `DROP INDEX IF EXISTS ${ident(`i_${tableName(c)}_${step.name}`)}`
        );
        try {
          db.exec(`ALTER TABLE ${table} DROP COLUMN ${ident(step.name)}`);
        } catch (error) {
          throw new StoreError(
            'incompatible_change',
            `Component '${c.name}' can't drop column '${step.name}': ${(error as Error).message}`
          );
        }
        break;
      case 'rebuild':
        break;
    }
  }
  db.exec('UPDATE ecs_components SET columns = ?2 WHERE name = ?1', [
    c.name,
    toJSON(c)
  ]);
  if (steps.some(s => s.kind === 'rebuild')) {
    rebuild(store, c);
  }
  store.components.set(c.name, c);
};

const fill = (store: Store, c: Component, col: Column, where: string) => {
  const value = storedDefault(c, col);
  if (value !== null) {
    store.db.exec(
      `UPDATE ${ident(tableName(c))} SET ${ident(col.name)} = ?1${where}`,
      [value]
    );
  }
};

/**
 * A table whose foreign keys aren't those its definition asks for, such as
 * one made before References had keys, is rebuilt with them. SQLite can't
 * add a foreign key to an existing table.
 */
const ensureKeys = (store: Store, c: Component) => {
  const actual = new Set(
    all<{ from: string; on_delete: string }>(
      store.db,
      'SELECT "from", on_delete FROM pragma_foreign_key_list(?1)',
      [tableName(c)]
    ).map(r => `${r.from} ${r.on_delete}`)
  );
  const wanted = foreignKeys(c);
  if (
    actual.size !== wanted.size ||
    [...wanted].some(key => !actual.has(key))
  ) {
    rebuild(store, c);
  }
};

const count = (db: Database, sql: string) =>
  Number(Object.values(all(db, sql)[0] ?? { n: 0 })[0]);

/**
 * Makes the table again from its definition, keeping its rows, unless they
 * break a unique column or hold a Reference to a missing entity
 */
const rebuild = (store: Store, c: Component) => {
  const { db } = store;
  const table = ident(tableName(c));

  const duplicated = c.columns
    .filter(col => col.unique)
    .map(col => {
      const collate = col.caseInsensitive ? ' COLLATE NOCASE' : '';
      const n = count(
        db,
        `SELECT count(*) AS n FROM (SELECT 1 FROM ${table} WHERE ${ident(col.name)} IS NOT NULL ` +
          `GROUP BY ${ident(col.name)}${collate} HAVING count(*) > 1)`
      );
      return n > 0 ? `'${col.name}' has ${n} value(s) held more than once` : '';
    })
    .filter(Boolean);
  if (duplicated.length > 0) {
    throw new StoreError(
      'incompatible_change',
      `Component '${c.name}' can't be made unique: ${duplicated.join(', ')}.`
    );
  }

  const dangling = c.columns
    .filter(col => col.type === 'eid')
    .map(col => {
      const n = count(
        db,
        `SELECT count(*) AS n FROM ${table} WHERE ${ident(col.name)} IS NOT NULL ` +
          `AND ${ident(col.name)} NOT IN (SELECT eid FROM entities)`
      );
      return n > 0 ? `${n} in '${col.name}'` : '';
    })
    .filter(Boolean);
  if (dangling.length > 0) {
    throw new StoreError(
      'dangling_reference',
      `Component '${c.name}' can't get its Reference keys: ${dangling.join(', ')} refer to entities that don't exist.`
    );
  }

  const next = `${tableName(c)}__rebuild`;
  const cols = ['eid', ...c.columns.map(col => col.name)].map(ident).join(', ');
  db.exec(createSql(c, next));
  db.exec(
    `INSERT INTO ${ident(next)} (${cols}) SELECT ${cols} FROM ${table}; ` +
      `DROP TABLE ${table}; ALTER TABLE ${ident(next)} RENAME TO ${table}`
  );
};

/** The component definition called `name`, or undefined */
export const getComponent = (store: Store, name: string) =>
  store.components.get(name);

const fetchComponent = (store: Store, name: string) => {
  const c = store.components.get(name);
  if (!c) {
    throw new StoreError(
      'unknown_component',
      `No component '${name}' is defined.`
    );
  }
  return c;
};

// -- Entities -------------------------------------------------------------------

/** Makes an entity with no components */
export const createEntity = (store: Store): Eid => store.db.addEntity();

/** Whether the entity exists */
export const exists = (store: Store, eid: Eid) =>
  all(store.db, 'SELECT 1 AS found FROM entities WHERE eid = ?1', [eid])
    .length > 0;

/**
 * Deletes an entity and its components. Entities holding a `cascade`
 * Reference to it are deleted too, and `nullify` References to it are
 * emptied. A `restrict` Reference to it, the default, refuses the delete
 * with a `referenced` error and changes nothing.
 */
export const deleteEntity = (store: Store, eid: Eid) => {
  try {
    store.db.exec('DELETE FROM entities WHERE eid = ?1', [eid]);
  } catch (error) {
    if (String((error as Error).message).includes('FOREIGN KEY constraint')) {
      throw new StoreError(
        'referenced',
        `Entity ${eid} can't be deleted: ${referrers(store, eid)}.`
      );
    }
    throw error;
  }
};

/** What holds a `restrict` Reference to an entity, for an error message */
const referrers = (store: Store, eid: Eid) => {
  const out: string[] = [];
  for (const [name, c] of store.components) {
    for (const col of c.columns) {
      if (col.type === 'eid' && col.onDelete === 'restrict') {
        const holders = query(store, { where: [[name, col.name, eid]] });
        if (holders.length > 0) {
          out.push(`${name}.${col.name} of ${holders.join(', ')} refers to it`);
        }
      }
    }
  }
  return out.join('; ');
};

/**
 * Gives an entity a component, replacing it whole if it has it already.
 * Properties missing from `data` take their defaults.
 */
export const put = (store: Store, eid: Eid, name: string, data: Data) => {
  const c = fetchComponent(store, name);
  if (!exists(store, eid)) {
    throw new StoreError('unknown_entity', `No entity ${eid}.`);
  }
  const values = encode(c, data);
  const cols = ['eid', ...c.columns.map(col => col.name)].map(ident);
  const params = cols.map((_, i) => `?${i + 1}`).join(', ');
  // An upsert, not INSERT OR REPLACE, which would delete another entity's
  // row to satisfy a unique column
  const rest = cols.slice(1);
  const updates =
    rest.length === 0
      ? 'NOTHING'
      : `UPDATE SET ${rest.map(col => `${col} = excluded.${col}`).join(', ')}`;
  try {
    store.db.exec(
      `INSERT INTO ${ident(tableName(c))} (${cols.join(', ')}) VALUES (${params}) ON CONFLICT(eid) DO ${updates}`,
      [eid, ...values]
    );
  } catch (error) {
    throw new StoreError(
      'constraint',
      `Component '${name}': ${(error as Error).message}`
    );
  }
};

/** Takes a component from an entity */
export const remove = (store: Store, eid: Eid, name: string) => {
  const c = fetchComponent(store, name);
  store.db.exec(`DELETE FROM ${ident(tableName(c))} WHERE eid = ?1`, [eid]);
};

/** An entity's component, or undefined if it has none by that name */
export const get = (store: Store, eid: Eid, name: string): Data | undefined =>
  select(store, [name], { eids: [eid] })[0]?.[1][name];

/** Every component an entity has, by name */
export const components = (store: Store, eid: Eid): Record<string, Data> =>
  select(store, [...store.components.keys()], { eids: [eid] })[0]?.[1] ?? {};

// -- Queries ----------------------------------------------------------------------

export const OPS = ['==', '!=', '<', '<=', '>', '>=', 'in'] as const;
export type Op = (typeof OPS)[number];

/**
 * `[component, property, value]` tests equality, and a null value matches a
 * missing one. `[component, property, op, value]` takes an `op` from `OPS`
 * (`in` with a list).
 */
export type Condition =
  readonly [string, string, unknown] | readonly [string, string, Op, unknown];

export type Order =
  readonly [string, string] | readonly [string, string, 'asc' | 'desc'];

export type QueryOptions = {
  /** Only these entities */
  eids?: readonly Eid[];
  /** At most this many */
  limit?: number;
  /** Skip this many (TypeScript only) */
  offset?: number;
  /** Entity id breaks ties */
  orderBy?: readonly Order[];
  /**
   * A raw SQL condition (TypeScript only). Each component is joined under
   * its own name, so it can say `stats.hp > ?`.
   */
  sql?: { args?: readonly unknown[]; where: string };
  /** Conditions that all hold; each implies its component */
  where?: readonly Condition[];
  /** Components every result has */
  with?: readonly string[];
  /** Components no result has (TypeScript only) */
  without?: readonly string[];
};

// SQLite joins at most 64 tables in one statement
const MAX_JOINS = 60;

const normaliseCondition = (
  c: Condition
): { name: string; op: Op; prop: string; value: unknown } => {
  if (c.length === 3) {
    return { name: c[0], op: '==', prop: c[1], value: c[2] };
  }
  if (c.length === 4 && OPS.includes(c[2])) {
    return { name: c[0], op: c[2], prop: c[1], value: c[3] };
  }
  throw new TypeError(`Unknown query condition: ${JSON.stringify(c)}`);
};

const normaliseOrder = (o: Order) => {
  const dir = o[2] ?? 'asc';
  if (dir !== 'asc' && dir !== 'desc') {
    throw new TypeError(`Unknown query order: ${JSON.stringify(o)}`);
  }
  return { dir, name: o[0], prop: o[1] };
};

const fetchColumn = (store: Store, name: string, prop: string) => {
  const col = store.components.get(name)?.columns.find(c => c.name === prop);
  if (!col) {
    throw new TypeError(`Component '${name}' has no property '${prop}'.`);
  }
  return col;
};

const sqlCondition = (
  lhs: string,
  op: Op,
  col: Column,
  value: unknown
): [string, unknown[]] => {
  switch (op) {
    case '==':
      return [`${lhs} IS ?`, [queryValue(col, value)]];
    case '!=':
      return [`${lhs} IS NOT ?`, [queryValue(col, value)]];
    case 'in':
      if (!Array.isArray(value)) {
        throw new TypeError(`Bad value for in: ${JSON.stringify(value)}`);
      }
      return [
        `${lhs} IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(value.map(v => queryValue(col, v)))]
      ];
    default:
      return [`${lhs} ${op} ?`, [queryValue(col, value)]];
  }
};

type Plan = {
  args: unknown[];
  read: (row: Record<string, unknown>) => [Eid, Record<string, Data>];
  sql: string;
};

/**
 * The SQL for a query, its arguments, and how to read a row; undefined when
 * a component it requires isn't defined, so nothing can match.
 */
const plan = (
  store: Store,
  selected: readonly string[],
  opts: QueryOptions
): Plan | undefined => {
  const where = (opts.where ?? []).map(normaliseCondition);
  const orderBy = (opts.orderBy ?? []).map(normaliseOrder);
  const required = [
    ...new Set([...(opts.with ?? []), ...where.map(w => w.name)])
  ];
  if (required.some(name => !store.components.has(name))) {
    return undefined;
  }
  const optional = [
    ...new Set([...selected, ...orderBy.map(o => o.name)])
  ].filter(name => !required.includes(name));
  const names = [...required, ...optional];
  const aliasOf = new Map(names.map(n => [n, ident(n)]));

  const joins = names
    .map(name => {
      const kind = required.includes(name) ? 'JOIN' : 'LEFT JOIN';
      const a = aliasOf.get(name)!;
      return ` ${kind} ${ident(tableName(name))} ${a} ON ${a}.eid = e.eid`;
    })
    .join('');

  const conds: string[] = [];
  const args: unknown[] = [];
  for (const { name, op, prop, value } of where) {
    const col = fetchColumn(store, name, prop);
    const [sql, a] = sqlCondition(
      `${aliasOf.get(name)}.${ident(prop)}`,
      op,
      col,
      value
    );
    conds.push(sql);
    args.push(...a);
  }

  let without = '';
  for (const [i, name] of (opts.without ?? []).entries()) {
    if (store.components.has(name)) {
      const a = `w${i}`;
      without += ` LEFT JOIN ${ident(tableName(name))} ${a} ON ${a}.eid = e.eid`;
      conds.push(`${a}.eid IS NULL`);
    }
  }

  if (opts.sql) {
    conds.push(`(${opts.sql.where})`);
    args.push(...(opts.sql.args ?? []));
  }

  if (opts.eids) {
    conds.push('e.eid IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(opts.eids));
  }

  const whereSql = conds.length === 0 ? '' : ` WHERE ${conds.join(' AND ')}`;
  const orderSql = [
    ...orderBy.map(({ dir, name, prop }) => {
      fetchColumn(store, name, prop);
      return `${aliasOf.get(name)}.${ident(prop)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }),
    'e.eid'
  ].join(', ');

  let limitSql = '';
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 0) {
      throw new TypeError(`Bad query limit: ${JSON.stringify(opts.limit)}`);
    }
    limitSql = ' LIMIT ?';
    args.push(opts.limit);
  }
  if (opts.offset !== undefined) {
    limitSql = `${limitSql || ' LIMIT -1'} OFFSET ?`;
    args.push(opts.offset);
  }

  const defs = selected.map(name => store.components.get(name)!);
  const cols = defs.flatMap((c, i) => {
    const a = aliasOf.get(c.name)!;
    return [
      `${a}.eid AS p${i}`,
      ...c.columns.map((col, j) => `${a}.${ident(col.name)} AS v${i}_${j}`)
    ];
  });

  const sql =
    `SELECT ${['e.eid AS eid', ...cols].join(', ')} FROM entities e${joins}${without}` +
    `${whereSql} ORDER BY ${orderSql}${limitSql}`;

  const read = (row: Record<string, unknown>): [Eid, Record<string, Data>] => {
    const data: Record<string, Data> = {};
    for (const [i, c] of defs.entries()) {
      if (row[`p${i}`] !== null && row[`p${i}`] !== undefined) {
        data[c.name] = decode(
          c,
          c.columns.map((_, j) => row[`v${i}_${j}`])
        );
      }
    }
    return [Number(row.eid), data];
  };

  return { args, read, sql };
};

/**
 * The entities that match every option, in id order unless `orderBy` says
 * otherwise. With no options, every entity.
 */
export const query = (store: Store, opts: QueryOptions = {}): Eid[] => {
  const p = plan(store, [], opts);
  return p ? all(store.db, p.sql, p.args).map(r => Number(r.eid)) : [];
};

/**
 * The entities `query` finds for `opts`, each with its data for the
 * components in `names` that it has. One statement reads them all.
 */
export const select = (
  store: Store,
  names: readonly string[],
  opts: QueryOptions = {}
): [Eid, Record<string, Data>][] => {
  const known = [...new Set(names)].filter(n => store.components.has(n));
  if (known.length > MAX_JOINS) {
    const parts: [Eid, Record<string, Data>][][] = [];
    for (let i = 0; i < known.length; i += MAX_JOINS) {
      parts.push(select(store, known.slice(i, i + MAX_JOINS), opts));
    }
    return parts[0]!.map(([eid], row) => [
      eid,
      Object.assign({}, ...parts.map(p => p[row]![1])) as Record<string, Data>
    ]);
  }
  const p = plan(store, known, opts);
  return p ? all(store.db, p.sql, p.args).map(p.read) : [];
};
