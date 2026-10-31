// Utilities for safely using SQL identifiers (table/column names)

// SQLite reserved keywords (uppercase); include common ones we may hit.
const SQLITE_RESERVED = new Set<string>([
  'ABORT',
  'ACTION',
  'ADD',
  'AFTER',
  'ALL',
  'ALTER',
  'ANALYZE',
  'AND',
  'AS',
  'ASC',
  'ATTACH',
  'AUTOINCREMENT',
  'BEFORE',
  'BEGIN',
  'BETWEEN',
  'BY',
  'CASCADE',
  'CASE',
  'CAST',
  'CHECK',
  'COLLATE',
  'COLUMN',
  'COMMIT',
  'CONFLICT',
  'CONSTRAINT',
  'CREATE',
  'CROSS',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'DATABASE',
  'DEFAULT',
  'DEFERRABLE',
  'DEFERRED',
  'DELETE',
  'DESC',
  'DETACH',
  'DISTINCT',
  'DROP',
  'EACH',
  'ELSE',
  'END',
  'ESCAPE',
  'EXCEPT',
  'EXCLUSIVE',
  'EXISTS',
  'EXPLAIN',
  'FAIL',
  'FOR',
  'FOREIGN',
  'FROM',
  'FULL',
  'GLOB',
  'GROUP',
  'HAVING',
  'IF',
  'IGNORE',
  'IMMEDIATE',
  'IN',
  'INDEX',
  'INDEXED',
  'INITIALLY',
  'INNER',
  'INSERT',
  'INSTEAD',
  'INTERSECT',
  'INTO',
  'IS',
  'ISNULL',
  'JOIN',
  'KEY',
  'LEFT',
  'LIKE',
  'LIMIT',
  'MATCH',
  'NATURAL',
  'NO',
  'NOT',
  'NOTNULL',
  'NULL',
  'OF',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'PLAN',
  'PRAGMA',
  'PRIMARY',
  'QUERY',
  'RAISE',
  'RECURSIVE',
  'REFERENCES',
  'REGEXP',
  'REINDEX',
  'RELEASE',
  'RENAME',
  'REPLACE',
  'RESTRICT',
  'RIGHT',
  'ROLLBACK',
  'ROW',
  'SAVEPOINT',
  'SELECT',
  'SET',
  'TABLE',
  'TEMP',
  'TEMPORARY',
  'THEN',
  'TO',
  'TRANSACTION',
  'TRIGGER',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'USING',
  'VACUUM',
  'VALUES',
  'VIEW',
  'VIRTUAL',
  'WHEN',
  'WHERE',
  'WITH',
  'WITHOUT'
]);

// Whether an identifier needs quoting (reserved or contains special chars)
export const needsQuoting = (ident: string): boolean => {
  if (!ident) {
    return false;
  }
  const up = ident.toUpperCase();
  if (SQLITE_RESERVED.has(up)) {
    return true;
  }
  // Quote if it contains anything other than letters, numbers, or underscore
  return /\W/.test(ident);
};

// Quote identifier with double quotes and escape embedded quotes
export const quoteIdent = (ident: string): string => {
  if (!ident) {
    return ident;
  }
  const escaped = ident.replaceAll('"', '""');
  return `"${escaped}"`;
};

// Quote only when necessary
export const q = (ident: string): string =>
  needsQuoting(ident) ? quoteIdent(ident) : ident;
