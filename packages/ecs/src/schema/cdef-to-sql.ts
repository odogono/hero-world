import { toSnakeCase } from 'odgn-helpers/string';

import type { CDef, CDefColumnInfo } from '@types';

import type { StatementOptions } from './types';

export type CDefToSqlInput = CDef | CDef[] | CDef[][];

export type CDefToSqlOptions = {
  down?: boolean;
  includeEntity?: boolean;
  up?: boolean;
};

export type CDefToSqlResult = {
  sql: string;
  tableNames: string[];
};

const toSqlType = (col: CDefColumnInfo, columnName: string): string => {
  switch (col.type) {
    case 'pk':
      return 'INTEGER';
    case 'string':
    case 'email':
    case 'enum':
    case 'date':
    case 'json':
    case 'array':
    case 'time':
      return 'TEXT';
    case 'int':
      // Special-case: auto-added 'eid' should remain INTEGER
      if (columnName === 'eid') {
        return 'INTEGER';
      }

      return 'INTEGER';
    case 'float':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'datetime':
    case 'timestamp':
      return 'DATETIME';
    default:
      return 'TEXT';
  }
};

const normalizeDefault = (
  val: unknown,
  type?: CDefColumnInfo['type']
): string | undefined => {
  if (val === undefined) {
    return undefined;
  }
  if (typeof val === 'string') {
    const up = val.toUpperCase();
    if (up === 'CURRENT_TIMESTAMP') {
      return 'DEFAULT CURRENT_TIMESTAMP';
    }
    return `DEFAULT '${val}'`;
  }
  if (typeof val === 'number') {
    if (type === 'float' && Number.isInteger(val)) {
      return `DEFAULT ${val}.0`;
    }
    return `DEFAULT ${val}`;
  }
  if (typeof val === 'boolean') {
    return `DEFAULT ${val ? '1' : '0'}`;
  }
  return `DEFAULT '${String(val)}'`;
};

const buildColumnDef = (
  rawName: string,
  col: CDefColumnInfo
): { column: string; fk?: string } => {
  const name = toSnakeCase(rawName) || rawName;
  const sqlType = toSqlType(col, name);

  // Determine NULL/NOT NULL
  const hasDefault = col.default !== undefined;
  const isEnum = col.type === 'enum';
  // Defaults: columns are nullable unless explicitly required, are enum, or have default
  const isNotNull = col.optional === false || isEnum || hasDefault;

  const parts: string[] = [name, sqlType];

  if (col.type === 'pk') {
    parts.push('PRIMARY KEY', 'AUTOINCREMENT');
  } else {
    parts.push(isNotNull ? 'NOT NULL' : 'NULL');
  }

  if (col.isUnique) {
    parts.push('UNIQUE');
  }

  const def = normalizeDefault(col.default, col.type);
  if (def) {
    parts.push(def);
  }

  let fk: string | undefined;
  if (col.foreignKey) {
    const cascade = ' ON DELETE CASCADE';
    fk = `FOREIGN KEY (${name}) REFERENCES ${col.foreignKey} (id)${cascade}`;
  }

  return { column: parts.join(' '), fk };
};

const autoColumns = (): { columns: string[]; fks: string[] } => {
  const columns: string[] = [];
  const fks: string[] = [];

  // id primary key
  columns.push('id INTEGER PRIMARY KEY AUTOINCREMENT', 'eid INTEGER NULL');
  fks.push('FOREIGN KEY (eid) REFERENCES tbl_entity (id) ON DELETE CASCADE');

  // created_at, updated_at with default CURRENT_TIMESTAMP
  columns.push(
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  );

  return { columns, fks };
};

const toTableName = (cdef: CDef): string =>
  cdef.tableName || `tbl_${toSnakeCase(cdef.id) || cdef.id}`;

type ColumnInfo = {
  name: string;
  type: string;
};

const getColumns = (cdef: CDef): ColumnInfo[] => {
  const result: ColumnInfo[] = [
    { name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' },
    { name: 'eid', type: 'INTEGER NULL' }
  ];
  const seen = new Set<string>(result.map(c => c.name));

  for (const col of cdef.columns) {
    const name = toSnakeCase(col.name) ?? col.name;
    if (seen.has(name)) {
      continue;
    }
    result.push({ name, type: toSqlType(col, name) });
    seen.add(name);
  }

  return result;
};

const buildCreateTable = (cdef: CDef) => {
  const tableName = toTableName(cdef);
  const seen = new Set<string>();

  const cols: string[] = [];
  const fks: string[] = [];
  const indexes: string[] = [];

  // Auto columns first
  const auto = autoColumns();
  for (const c of auto.columns) {
    const name = c.split(' ')[0] as string;
    seen.add(name);
    cols.push(c);
  }
  fks.push(...auto.fks);

  // User-defined columns
  for (const col of cdef.columns) {
    const name = toSnakeCase(col.name) || col.name;
    // Skip if already provided by auto columns (id/eid/created_at/updated_at)
    if (seen.has(name)) {
      continue;
    }

    const { column, fk } = buildColumnDef(col.name, col);
    cols.push(column);
    if (fk) {
      fks.push(fk);
    }

    if (col.isIndexed) {
      const idxName = `idx_${tableName}_${name}`;
      const unique = col.isUnique ? 'UNIQUE ' : '';
      indexes.push(
        `CREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${name});`
      );
    }
  }

  const all = [...cols, ...fks];
  const createSql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${all.join(',\n  ')}\n);`;
  return { indexes, sql: createSql, tableName };
};

const buildDropStatements = (cdef: CDef): string[] => {
  const tableName = toTableName(cdef);
  const stmts: string[] = [];
  // Drop indexes that may have been created
  for (const col of cdef.columns) {
    if (col.isIndexed) {
      const name = toSnakeCase(col.name) || col.name;
      const idxName = `idx_${tableName}_${name}`;
      stmts.push(`DROP INDEX IF EXISTS ${idxName};`);
    }
  }
  // Then drop table
  stmts.push(`DROP TABLE IF EXISTS ${tableName};`);
  return stmts;
};

export const cdefToSql = (
  input: CDefToSqlInput,
  options: CDefToSqlOptions = {}
): CDefToSqlResult => {
  const { down = false, includeEntity = false, up = true } = options;

  // Normalize input into a flat array of CDef
  const defs: CDef[] = Array.isArray(input)
    ? (input as any[]).flat(Infinity).filter(Boolean)
    : [input];

  const stmts: string[] = [];
  const tableNames: string[] = [];

  if (includeEntity && up) {
    // Basic entity table
    stmts.push(
      'CREATE TABLE IF NOT EXISTS tbl_entity (\n  id INTEGER PRIMARY KEY AUTOINCREMENT\n);'
    );
  }

  if (up) {
    for (const d of defs) {
      const { indexes, sql, tableName } = buildCreateTable(d);
      stmts.push(sql, ...indexes);
      tableNames.push(tableName);
    }
  }

  if (down) {
    for (const d of defs) {
      const drops = buildDropStatements(d);
      stmts.push(...drops);
    }
    if (includeEntity) {
      stmts.push('DROP TABLE IF EXISTS tbl_entity;');
    }
  }

  return { sql: stmts.join('\n'), tableNames };
};

export const cdefToSqlCreate = (cdef: CDef, options: CDefToSqlOptions = {}) => {
  const { down = false, includeEntity = false, up = true } = options;

  const { indexes, sql, tableName } = buildCreateTable(cdef);

  const columns = getColumns(cdef);

  return { columns, indexes, sql, tableName };
};

export const cdefToSqlInsert = (cdef: CDef, options: StatementOptions = {}) => {
  const tableName = options.tableName ?? toTableName(cdef);

  // Build columns list for INSERT
  // Include eid and all user-defined columns except auto-increment id
  const statementColumns = getColumns(cdef)
    .map(c => c.name)
    .filter(name => name !== 'id');

  const placeholders = statementColumns.map((col, index) =>
    options.namedParams ? `:${col}` : `?${index + 1}`
  );

  return `INSERT INTO ${tableName} (${statementColumns.join(', ')}) VALUES (${placeholders.join(', ')})`;
};
export const cdefToSqlUpdate = (cdef: CDef, options: StatementOptions = {}) => {
  const tableName = options.tableName ?? toTableName(cdef);

  // Exclude id and eid from SET columns; eid used in WHERE
  const setColumns = getColumns(cdef)
    .map(c => c.name)
    .filter(name => name !== 'id' && name !== 'eid');

  const placeholders = setColumns.map((col, index) =>
    options.namedParams ? `:${col}` : `?${index + 1}`
  );

  const whereClause = options.namedParams ? ':eid' : '?';

  return `UPDATE ${tableName} SET (${setColumns.join(', ')}) = (${placeholders.join(', ')}) WHERE eid = ${whereClause}`;
};

// Optional select helpers to mirror zod schema functions
export const cdefToSqlSelect = (
  cdef: CDef,
  options: { tableName?: string } = {}
): string => {
  const tableName = options.tableName ?? toTableName(cdef);
  // Select all known columns except internal eid
  const columns = getColumns(cdef).map(c => c.name);
  return `SELECT ${columns.join(', ')} FROM ${tableName}`;
};

export const cdefToSqlSelectWhere = (
  cdef: CDef,
  selectColumn: string,
  whereColumn: string | string[]
): string => {
  const tableName = toTableName(cdef);
  const whereColumns = Array.isArray(whereColumn) ? whereColumn : [whereColumn];
  const whereConditions = whereColumns.map(
    (col, index) => `${col} = ?${index + 1}`
  );
  const whereClause = whereConditions.join(' AND ');
  return `SELECT ${selectColumn} FROM ${tableName} WHERE ${whereClause}`;
};
