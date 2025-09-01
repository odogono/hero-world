import alasql from 'alasql';

import { parseArgs } from './helpers';
import type {
  CreateDatabaseOptions,
  Database,
  LoadFromJSONOptions,
  SaveToJSONOptions,
  Statement,
  StatementArgs,
  StatementRunResult
} from './index';
import {
  loadFromJSON as sharedLoadFromJSON,
  saveToJSON as sharedSaveToJSON
} from './json-functions';

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
      // Use the database's exec method which handles SQL conversion
      const r = this.db.exec(this.sql, args);
      if (this.sql.includes('DEFAULT VALUES')) {
        throw new Error('DEFAULT VALUES is not supported');
      }

      // For INSERT statements, try to get the last inserted ID
      const lastInsertRowId = 0;
      // if (this.sql.trim().toUpperCase().startsWith('INSERT')) {
      //   const lastRow = alasql(
      //     `SELECT * FROM tbl_entity ORDER BY id DESC LIMIT 1`
      //   );

      //   // AlasQL doesn't have built-in last insert ID, so we simulate it
      //   // by querying the max ID from the table if possible
      //   const tableMatch = this.sql.match(/insert\s+into\s+(\w+)/i);
      //   if (tableMatch) {
      //     const tableName = tableMatch[1];
      //     try {
      //       const maxResult = alasql(
      //         `SELECT MAX(id) as maxId FROM ${tableName}`
      //       );
      //       if (maxResult && maxResult.length > 0 && maxResult[0].maxId) {
      //         lastInsertRowId = maxResult[0].maxId + 1;
      //       }
      //     } catch {
      //       // Ignore errors when trying to get max ID
      //     }
      //   }
      // }

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
    // Manually manage IDs since AlasQL IDENTITY doesn't work reliably
    const existingRows = alasql(
      'SELECT id FROM tbl_entity ORDER BY id DESC LIMIT 1'
    ) as { id: number }[];
    const nextId = existingRows.length > 0 ? (existingRows[0]?.id ?? 0) + 1 : 1;

    // Insert with explicit ID since IDENTITY seems problematic
    alasql(`INSERT INTO tbl_entity (id) VALUES (${nextId})`);

    return nextId;
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
          if (processedSql.includes(numberedPlaceholder)) {
            processedSql = processedSql.replace(
              numberedPlaceholder,
              replacement
            );
          } else {
            // Replace the first occurrence of ? with the value
            processedSql = processedSql.replace(simplePlaceholder, replacement);
          }
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
          if (processedSql.includes(numberedPlaceholder)) {
            processedSql = processedSql.replace(
              numberedPlaceholder,
              replacement
            );
          } else {
            // Replace the first occurrence of ? with the value
            processedSql = processedSql.replace(simplePlaceholder, replacement);
          }
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

    // Debug logging
    // console.log('Original SQL:', sql);

    // Convert SQLite-specific features to AlasQL compatible ones

    // Remove SQLite pragmas completely (AlasQL doesn't support them)
    if (convertedSql.match(/pragma\s+[^;]+;?\s*/gi)) {
      return ''; // Return empty string for pragma statements
    }

    // Handle CREATE TABLE column definitions first
    convertedSql = convertedSql.replaceAll(
      /(\s)(value|counter|name|order|group|user|date|time|index)(\s+text)/gi,
      '$1[$2]$3'
    );
    convertedSql = convertedSql.replaceAll(
      /(\s)(value|counter|name|order|group|user|date|time|index)(\s+integer)/gi,
      '$1[$2]$3'
    );
    convertedSql = convertedSql.replaceAll(
      /(\s)(value|counter|name|order|group|user|date|time|index)(\s+real)/gi,
      '$1[$2]$3'
    );

    // Handle reserved words in column lists and SELECT column references (but not in CREATE TABLE or UPDATE)
    if (
      !convertedSql.includes('CREATE TABLE') &&
      !convertedSql.includes('UPDATE ')
    ) {
      // Replace reserved words in column lists (but not parameter names starting with :)
      convertedSql = convertedSql.replaceAll(
        /(?<!:)\b(value|counter|name|order|group|user|date|time|index)\b(?=\s*[),])/gi,
        '[$1]'
      );

      // Also replace reserved words in SELECT column references like table.column
      convertedSql = convertedSql.replaceAll(
        /(\w+)\.(value|counter|name|order|group|user|date|time|index)\b/gi,
        '$1.[$2]'
      );
    }

    // Handle reserved words in UPDATE SET clauses
    if (convertedSql.includes('UPDATE ')) {
      convertedSql = convertedSql.replaceAll(
        /\bset\s+([^=]+)\b(value|counter|name|order|group|user|date|time|index)\b/gi,
        (match, before, reservedWord) => `SET ${before}[${reservedWord}]`
      );
    }

    // Handle reserved words in WHERE clauses and other expressions
    convertedSql = convertedSql.replaceAll(
      /(\s|\w+\.)(value|counter|name|order|group|user|date|time|index)(\s*[\s!),<=>])/gi,
      '$1[$2]$3'
    );

    // Special handling for entity table - don't use IDENTITY
    if (convertedSql.includes('tbl_entity')) {
      convertedSql = convertedSql.replaceAll(/\bautoincrement\b/gi, '');
      convertedSql = convertedSql.replaceAll(/\bidentity\b/gi, '');
    }

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

    // console.log('Converted SQL:', convertedSql);
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
    console.warn(
      'AlasQL saveToPath not fully implemented - requires custom serialization'
    );
  }

  transaction<T>(fn: () => T): T {
    // AlasQL doesn't have native transactions, so we just execute the function
    // In a real implementation, you might want to implement rollback logic

    return fn();
  }

  saveToJSON(options: SaveToJSONOptions = {}): unknown {
    return sharedSaveToJSON(this, options);
  }

  loadFromJSON(json: unknown, options: LoadFromJSONOptions = {}): void {
    sharedLoadFromJSON(this, json, options);
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
