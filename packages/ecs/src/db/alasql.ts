import alasql from 'alasql';
import { createLog } from 'odgn-helpers/log';

import { parseArgs } from './helpers';
import type {
  CreateDatabaseOptions,
  Database,
  Statement,
  StatementArgs,
  StatementRunResult
} from './index';

const log = createLog('alasql');

// AlasSQL Statement wrapper
class AlasqlStatementWrapper implements Statement {
  private sql: string;
  private db: AlasqlDatabaseWrapper;
  private isFinalized = false;

  constructor(sql: string, db: AlasqlDatabaseWrapper) {
    this.sql = sql;
    this.db = db;
  }

  all(args?: StatementArgs): unknown {
    if (this.isFinalized) {
      throw new Error('Statement has been finalized');
    }
    return this.db.query(this.sql, args);
  }

  finalize(): void {
    this.isFinalized = true;
  }

  get(input?: StatementArgs, ...rest: StatementArgs[]): unknown | null {
    if (this.isFinalized) {
      throw new Error('Statement has been finalized');
    }
    const args = parseArgs(input, ...rest);
    const results = this.db.query(this.sql, args);
    // console.debug('get', this.sql, args, results);
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
  }

  getColumnNames(): string[] {
    // AlasQL doesn't provide easy access to column names without executing
    // We'll extract from the first result or return empty array
    try {
      const result = this.all();
      if (
        Array.isArray(result) &&
        result.length > 0 &&
        typeof result[0] === 'object'
      ) {
        return Object.keys(result[0] as Record<string, unknown>);
      }
    } catch {
      // Ignore errors when getting column names
    }
    return [];
  }

  iterate(args?: StatementArgs): unknown | null {
    if (this.isFinalized) {
      throw new Error('Statement has been finalized');
    }
    // AlasQL doesn't have native iteration, return all results
    return this.all(args);
  }

  run(input?: StatementArgs, ...rest: StatementArgs[]): StatementRunResult {
    if (this.isFinalized) {
      throw new Error('Statement has been finalized');
    }
    const args = parseArgs(input, ...rest);

    try {
      let lastInsertRowId = 0;

      // Handle INSERT OR REPLACE by checking original SQL before conversion
      const originalSql = this.sql;
      const isInsertOrReplace = originalSql
        .toUpperCase()
        .includes('INSERT OR REPLACE');

      // Handle INSERT statements with auto-increment ID generation
      if (this.sql.trim().toUpperCase().startsWith('INSERT')) {
        const tableMatch = this.sql.match(/insert\s+into\s+(\w+)/i);

        // For INSERT OR REPLACE, implement the replace logic manually
        if (
          isInsertOrReplace &&
          args &&
          typeof args === 'object' &&
          tableMatch
        ) {
          const tableName = tableMatch[1];

          // For component metadata table, delete existing row with same tbl_name
          if (tableName === 'tbl_component_metadata' && 'tbl_name' in args) {
            try {
              this.db.exec(`DELETE FROM ${tableName} WHERE tbl_name = ?`, [
                args.tbl_name
              ]);
            } catch {
              // Ignore delete errors (row might not exist)
            }
          }
        }
        if (tableMatch) {
          const tableName = tableMatch[1];

          // Generate the next ID for this table
          const nextId = this.db.generateNextId(tableName, 'id');
          lastInsertRowId = nextId;

          // If the INSERT doesn't include an ID column, add it
          if (
            !this.sql.toLowerCase().includes('(id,') &&
            !this.sql.toLowerCase().includes('(id ')
          ) {
            // Modify the SQL to include the generated ID
            let modifiedSql = this.sql;
            const valuesMatch = modifiedSql.match(
              /\(([^)]+)\)\s+values\s+\(([^)]+)\)/i
            );
            if (valuesMatch) {
              const [, columns, values] = valuesMatch;
              const newColumns = `id, ${columns}`;
              const newValues = `${nextId}, ${values}`;
              modifiedSql = modifiedSql.replace(
                /\(([^)]+)\)\s+values\s+\(([^)]+)\)/i,
                `(${newColumns}) VALUES (${newValues})`
              );

              // Execute the modified SQL
              this.db.exec(modifiedSql, args);
            } else {
              // Fallback to original execution
              this.db.exec(this.sql, args);
            }
          } else {
            // SQL already includes ID, execute as-is
            this.db.exec(this.sql, args);
          }
        } else {
          // No table match, execute as-is
          this.db.exec(this.sql, args);
        }
      } else {
        // Not an INSERT, execute normally
        this.db.exec(this.sql, args);
      }

      if (this.sql.includes('DEFAULT VALUES')) {
        throw new Error('DEFAULT VALUES is not supported');
      }

      // For AlasQL, we assume 1 change for successful operations
      const changes = 1;

      return {
        changes,
        lastInsertRowId
      };
    } catch (error) {
      throw new Error(`AlasQL execution error: ${error}`);
    }
  }
}

// Wrapper for AlasQL database
export class AlasqlDatabaseWrapper implements Database {
  private databaseName: string;
  private isMemory: boolean;

  constructor(databaseName?: string) {
    this.databaseName = databaseName || 'memory';
    this.isMemory = !databaseName || databaseName === ':memory:';

    // Initialize AlasQL database
    if (!this.isMemory) {
      alasql(`CREATE DATABASE IF NOT EXISTS ${this.databaseName}`);
      alasql(`USE ${this.databaseName}`);
    }

    // Set up basic configuration
    alasql.options.cache = false; // Disable caching for consistency
  }

  addEntity(): number {
    const nextId = this.generateNextId('tbl_entity', 'id');

    // Insert with explicit ID since IDENTITY doesn't work reliably
    alasql(`INSERT INTO tbl_entity (id) VALUES (${nextId})`);

    return nextId;
  }

  generateNextId(tableName: string, idColumn: string = 'id'): number {
    // Manually manage IDs since AlasQL IDENTITY doesn't work reliably
    try {
      const existingRows = alasql(
        `SELECT ${idColumn} FROM ${tableName} ORDER BY ${idColumn} DESC LIMIT 1`
      ) as { [key: string]: number }[];
      const nextId =
        existingRows.length > 0 ? (existingRows[0]?.[idColumn] ?? 0) + 1 : 1;

      return nextId;
    } catch {
      // If table doesn't exist or is empty, start from 1
      return 1;
    }
  }

  close(): void {
    if (!this.isMemory) {
      try {
        alasql(`DROP DATABASE IF EXISTS ${this.databaseName}`);
      } catch {
        // Ignore errors when closing
      }
    }
  }

  exec(sql: string, input?: StatementArgs, ...rest: StatementArgs[]): void {
    const args = parseArgs(input, ...rest);

    try {
      // Convert SQLite-specific syntax to AlasQL compatible syntax
      let processedSql = this.convertSqliteToAlasql(sql);

      // If the SQL was converted to empty string (e.g., PRAGMA), do nothing
      if (!processedSql || processedSql.trim() === '') {
        return;
      }

      if (args && Array.isArray(args)) {
        // Convert positional parameters - handle both ? and ?1, ?2, etc.
        args.forEach((arg, index) => {
          const numberedPlaceholder = `?${index + 1}`;
          const simplePlaceholder = '?';
          const replacement = this.formatValueForSql(arg);

          // Try numbered placeholder first, then simple placeholder
          // (otherwise replace the first occurrence of ? with the value)
          processedSql = processedSql.includes(numberedPlaceholder)
            ? processedSql.replace(numberedPlaceholder, replacement)
            : processedSql.replace(simplePlaceholder, replacement);
        });
      } else if (args && typeof args === 'object') {
        // Handle named parameters
        Object.entries(args).forEach(([key, value]) => {
          const placeholder = key.startsWith(':') ? key : `:${key}`;
          const replacement = this.formatValueForSql(value);
          processedSql = processedSql.replaceAll(
            new RegExp(`\\${placeholder}\\b`, 'g'),
            replacement
          );
        });
      }

      alasql(processedSql);
    } catch (error) {
      throw new Error(`AlasQL execution error: ${error}`);
    }
  }

  query(
    sql: string,
    input?: StatementArgs,
    ...rest: StatementArgs[]
  ): unknown[] {
    const args = parseArgs(input, ...rest);

    try {
      // Convert SQLite-specific syntax to AlasSQL compatible syntax
      let processedSql = this.convertSqliteToAlasql(sql);

      // If the SQL was converted to empty string (e.g., PRAGMA), return empty array
      if (!processedSql || processedSql.trim() === '') {
        return [];
      }

      if (args && Array.isArray(args)) {
        // Convert positional parameters - handle both ? and ?1, ?2, etc.
        args.forEach((arg, index) => {
          const numberedPlaceholder = `?${index + 1}`;
          const simplePlaceholder = '?';
          const replacement = this.formatValueForSql(arg);

          // Try numbered placeholder first, then simple placeholder
          // (otherwise replace the first occurrence of ? with the value)
          processedSql = processedSql.includes(numberedPlaceholder)
            ? processedSql.replace(numberedPlaceholder, replacement)
            : processedSql.replace(simplePlaceholder, replacement);
        });
      } else if (args && typeof args === 'object') {
        // Handle named parameters
        Object.entries(args).forEach(([key, value]) => {
          const placeholder = key.startsWith(':') ? key : `:${key}`;
          const replacement = this.formatValueForSql(value);
          processedSql = processedSql.replaceAll(
            new RegExp(`\\${placeholder}\\b`, 'g'),
            replacement
          );
        });
      }

      const result = alasql(processedSql);
      return Array.isArray(result) ? result : [result];
    } catch (error) {
      throw new Error(`AlasQL query error: ${error}`);
    }
  }

  private formatValueForSql(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'string') {
      return `'${value.replaceAll("'", "''")}'`; // Escape single quotes
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }
    return String(value);
  }

  private convertSqliteToAlasql(sql: string): string {
    let convertedSql = sql;

    // Debug logging for CREATE INDEX
    if (convertedSql.toUpperCase().includes('CREATE INDEX')) {
      log.debug('DEBUG: Original CREATE INDEX SQL:', sql);
    }

    // Convert SQLite-specific features to AlasQL compatible ones

    // Remove SQLite pragmas completely (AlasQL doesn't support them)
    if (convertedSql.match(/pragma\s+[^;]+;?\s*/gi)) {
      return ''; // Return empty string for pragma statements
    }

    // Handle CREATE TABLE column definitions first (but not in CREATE INDEX statements)
    if (!convertedSql.toUpperCase().includes('CREATE INDEX')) {
      convertedSql = convertedSql.replaceAll(
        /(\s)(value|counter|name|order|group|user|date|time)(\s+text)/gi,
        '$1[$2]$3'
      );
      convertedSql = convertedSql.replaceAll(
        /(\s)(value|counter|name|order|group|user|date|time)(\s+integer)/gi,
        '$1[$2]$3'
      );
      convertedSql = convertedSql.replaceAll(
        /(\s)(value|counter|name|order|group|user|date|time)(\s+real)/gi,
        '$1[$2]$3'
      );
    }

    // Handle reserved words in column lists and SELECT column references (but not in CREATE TABLE, UPDATE, CREATE INDEX, or ORDER BY)
    if (
      !convertedSql.includes('CREATE TABLE') &&
      !convertedSql.includes('UPDATE ') &&
      !convertedSql.toUpperCase().includes('CREATE INDEX') &&
      !convertedSql.toUpperCase().includes('ORDER BY')
    ) {
      // Replace reserved words in column lists (but not parameter names starting with :)
      convertedSql = convertedSql.replaceAll(
        /(?<!:)\b(value|counter|name|order|group|user|date|time)\b(?=\s*[),])/gi,
        '[$1]'
      );

      // Also replace reserved words in SELECT column references like table.column
      convertedSql = convertedSql.replaceAll(
        /(\w+)\.(value|counter|name|order|group|user|date|time)\b/gi,
        '$1.[$2]'
      );
    }

    // Handle reserved words in UPDATE SET clauses
    if (convertedSql.includes('UPDATE ')) {
      convertedSql = convertedSql.replaceAll(
        /\bset\s+([^=]+)\b(value|counter|name|order|group|user|date|time)\b/gi,
        (match, before, reservedWord) => `SET ${before}[${reservedWord}]`
      );
    }

    // Handle reserved words in WHERE clauses and other expressions (but not in CREATE INDEX or ORDER BY)
    if (
      !convertedSql.toUpperCase().includes('CREATE INDEX') &&
      !convertedSql.toUpperCase().includes('ORDER BY')
    ) {
      convertedSql = convertedSql.replaceAll(
        /(\s|\w+\.)(value|counter|name|order|group|user|date|time)(\s*[\s!),<=>])/gi,
        '$1[$2]$3'
      );
    }

    // AlasQL's IDENTITY doesn't work reliably, remove it from all tables
    // We'll handle ID generation manually in the statement run method
    convertedSql = convertedSql.replaceAll(/\bautoincrement\b/gi, '');
    convertedSql = convertedSql.replaceAll(/\bidentity\b/gi, '');

    // Convert SQL data types to AlasQL compatible types
    convertedSql = convertedSql.replaceAll(/\btext\b/gi, 'STRING');
    convertedSql = convertedSql.replaceAll(/\breal\b/gi, 'FLOAT');
    convertedSql = convertedSql.replaceAll(/\binteger\b/gi, 'INT');

    // Convert COUNT(*) to COUNT(1) which is supported by AlasQL
    convertedSql = convertedSql.replaceAll(
      /count\s*\(\s*\*\s*\)/gi,
      'COUNT(1)'
    );

    // Handle sqlite_master table queries (used by JSON functions)
    convertedSql = convertedSql.replaceAll(/sqlite_master/gi, 'sysobjects');

    // Convert AUTOINCREMENT to AlasQL's compatible syntax
    convertedSql = convertedSql.replaceAll(/\bautoincrement\b/gi, 'IDENTITY');

    // Handle CREATE INDEX IF NOT EXISTS - AlasQL doesn't support this syntax
    if (convertedSql.match(/create\s+.*index.*if\s+not\s+exists/gi)) {
      // For CREATE INDEX, just remove IF NOT EXISTS since AlasQL doesn't support it
      // and will just overwrite existing indexes anyway
      convertedSql = convertedSql.replaceAll(/if\s+not\s+exists\s+/gi, '');
    }

    // Handle INSERT OR REPLACE - AlasQL doesn't support this syntax well, convert to regular INSERT
    // We'll handle the replacement logic manually in our wrapper
    convertedSql = convertedSql.replaceAll(
      /insert\s+or\s+replace\s+into/gi,
      'INSERT INTO'
    );

    // Handle IF NOT EXISTS by checking table existence first
    if (convertedSql.match(/create\s+table\s+if\s+not\s+exists/gi)) {
      const tableMatch = convertedSql.match(
        /create\s+table\s+if\s+not\s+exists\s+(\w+)/i
      );
      if (tableMatch) {
        const tableName = tableMatch[1];
        // Check if table exists and only create if it doesn't
        try {
          alasql(`SELECT 1 FROM ${tableName} LIMIT 1`);
          return ''; // Table exists, don't create
        } catch {
          // Table doesn't exist, create it
          convertedSql = convertedSql.replaceAll(/if\s+not\s+exists\s+/gi, '');
        }
      }
    }

    // Convert foreign key constraints (remove them as AlasQL has limited FK support)
    // Remove the entire FOREIGN KEY constraint and any REFERENCES clauses
    convertedSql = convertedSql.replaceAll(
      /,\s*foreign\s+key[^;]*(?:;|$)/gi,
      ''
    );
    convertedSql = convertedSql.replaceAll(
      /foreign\s+key[^;]*(?:;|$),?\s*/gi,
      ''
    );
    convertedSql = convertedSql.replaceAll(
      /,\s*references[^),]*(?:on\s+delete\s+cascade)?/gi,
      ''
    );
    convertedSql = convertedSql.replaceAll(
      /references[^),]*(?:on\s+delete\s+cascade)?,?\s*/gi,
      ''
    );

    // Handle SQLite's UPDATE syntax - convert tuple updates to individual SET clauses
    convertedSql = convertedSql.replaceAll(
      /update\s+(\w+)\s+set\s+\(([^)]+)\)\s*=\s*\(([^)]+)\)\s+where\s+(.+)/gi,
      (match, table, columns, values, whereClause) => {
        const columnList = columns.split(',').map((col: string) => col.trim());
        const valueList = values.split(',').map((val: string) => val.trim());

        if (columnList.length !== valueList.length) {
          return match; // Return original if parsing fails
        }

        const setClause = columnList
          .map((col, index) => `${col} = ${valueList[index]}`)
          .join(', ');

        return `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
      }
    );

    // Clean up any extra parentheses or formatting issues and ensure proper closure
    convertedSql = convertedSql.replaceAll(/\)\s*\)\s*;/gi, ');');

    // If we removed a foreign key constraint and there's no closing paren, add it
    if (
      convertedSql.includes('CREATE TABLE') &&
      !convertedSql.match(/\)\s*;?\s*$/)
    ) {
      convertedSql = convertedSql.replace(/([^)]\s*)$/, '$1);');
    }

    // Debug logging for CREATE INDEX
    if (sql.toUpperCase().includes('CREATE INDEX')) {
      log.debug('DEBUG: Converted CREATE INDEX SQL:', convertedSql);
    }
    return convertedSql;
  }

  prepare(sql: string): Statement {
    return new AlasqlStatementWrapper(sql, this);
  }

  saveToPath(path: string): void {
    if (this.isMemory) {
      throw new Error('Cannot save in-memory AlasQL database to file');
    }

    // AlasQL doesn't have built-in file persistence like SQLite
    // This would require implementing custom serialization
    log.warn(
      'AlasQL saveToPath not fully implemented - requires custom serialization'
    );
  }

  transaction<T>(fn: () => T): T {
    // AlasQL doesn't have native transactions, so we just execute the function
    // In a real implementation, you might want to implement rollback logic

    return fn();
  }

  dump(): string {
    return '# not implemented';
  }
}

// Factory function for AlasQL
export const createAlasqlDatabaseInstance = async (
  options: CreateDatabaseOptions
): Promise<Database> => {
  const { path = ':memory:' } = options;
  const dbName =
    path === ':memory:' ? undefined : path.replaceAll(/[^\dA-Za-z]/g, '_');
  return new AlasqlDatabaseWrapper(dbName);
};
