import { toSnakeCase } from 'odgn-helpers/string';

import { defToTableName } from '@component';
import type { CDef, CDefColumnInfo } from '@types';

import { q } from '../db/sql-helpers';
import type { StatementOptions } from './types';

export type CDefToSqlInput = CDef | CDef[] | CDef[][];

export type CDefToSqlOptions = {
  down?: boolean;
  includeEntity?: boolean;
  tableName?: string;
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

  const parts: string[] = [q(name), sqlType];

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
    fk = `FOREIGN KEY (${q(name)}) REFERENCES ${col.foreignKey} (id)${cascade}`;
  }

  return { column: parts.join(' '), fk };
};

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
    if (name === 'id' || name === 'eid') {
      throw new Error(
        `Component '${cdef.id}' cannot define reserved column '${name}'.`
      );
    }
    if (seen.has(name)) {
      continue;
    }
    result.push({ name, type: toSqlType(col, name) });
    seen.add(name);
  }

  return result;
};

const buildCreateTable = (cdef: CDef, options?: StatementOptions) => {
  const tableName = options?.tableName ?? defToTableName(cdef);
  const seen = new Set<string>(['id', 'eid', 'created_at', 'updated_at']);

  const cols: string[] = [
    'id INTEGER PRIMARY KEY AUTOINCREMENT',
    'eid INTEGER NULL'
  ];
  const fks: string[] = [
    `FOREIGN KEY (${q('eid')}) REFERENCES tbl_entity (id) ON DELETE CASCADE`
  ];
  const indexes: string[] = [];

  // User-defined columns
  for (const col of cdef.columns) {
    const name = toSnakeCase(col.name) || col.name;
    if (name === 'id' || name === 'eid') {
      throw new Error(
        `Component '${cdef.id}' cannot define reserved column '${name}'.`
      );
    }
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
        `CREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${q(name)});`
      );
    }
  }

  cols.push(
    'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    'updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
  );

  const all = [...cols, ...fks];
  const createSql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${all.join(',\n  ')}\n);`;
  return { indexes, sql: createSql, tableName };
};

const buildDropStatements = (cdef: CDef): string[] => {
  const tableName = defToTableName(cdef);
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
  const {
    down = false,
    includeEntity = false,
    tableName: overrideTableName,
    up = true
  } = options;

  // Normalize input into a flat array of CDef
  const defs: CDef[] = Array.isArray(input)
    ? ((input as CDef[][]).flat(Infinity).filter(Boolean) as CDef[])
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
      const { indexes, sql, tableName } = buildCreateTable(d, {
        tableName: overrideTableName
      });
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

  const { indexes, sql, tableName } = buildCreateTable(cdef, options);

  const columns = getColumns(cdef);

  return { columns, indexes, sql, tableName };
};

export const cdefToSqlInsert = (cdef: CDef, options: StatementOptions = {}) => {
  const tableName = options.tableName ?? defToTableName(cdef);

  // Build columns list for INSERT
  // Include eid and all user-defined columns except auto-increment id
  const statementColumns = getColumns(cdef)
    .map(c => c.name)
    .filter(name => name !== 'id');

  const columnListSql = statementColumns.map(col => q(col)).join(', ');
  const placeholders = statementColumns.map((col, index) =>
    options.namedParams ? `:${col}` : `?${index + 1}`
  );

  return `INSERT INTO ${tableName} (${columnListSql}) VALUES (${placeholders.join(', ')})`;
};
export const cdefToSqlUpdate = (cdef: CDef, options: StatementOptions = {}) => {
  const tableName = options.tableName ?? defToTableName(cdef);

  // Exclude id and eid from SET columns; eid used in WHERE
  const setColumns = getColumns(cdef)
    .map(c => c.name)
    .filter(name => name !== 'id' && name !== 'eid');

  const setColumnsSql = setColumns.map(c => q(c)).join(', ');
  const placeholders = setColumns.map((col, index) =>
    options.namedParams ? `:${col}` : `?${index + 1}`
  );

  const whereClause = options.namedParams ? ':eid' : '?';

  return `UPDATE ${tableName} SET (${setColumnsSql}) = (${placeholders.join(', ')}) WHERE ${q('eid')} = ${whereClause}`;
};

// Optional select helpers to mirror zod schema functions
export const cdefToSqlSelect = (
  cdef: CDef,
  options: { tableName?: string } = {}
): string => {
  const tableName = options.tableName ?? defToTableName(cdef);
  // Select all known columns except internal eid
  const columns = getColumns(cdef).map(c => q(c.name));
  return `SELECT ${columns.join(', ')} FROM ${tableName}`;
};

export const cdefToSqlSelectWhere = (
  cdef: CDef,
  selectColumn: string,
  whereColumn: string | string[]
): string => {
  const tableName = defToTableName(cdef);
  const whereColumns = Array.isArray(whereColumn) ? whereColumn : [whereColumn];
  const whereConditions = whereColumns.map(
    (col, index) => `${q(col)} = ?${index + 1}`
  );
  const whereClause = whereConditions.join(' AND ');
  return `SELECT ${q(selectColumn)} FROM ${tableName} WHERE ${whereClause}`;
};
