import type {
  BindingSpec,
  Database as Sqlite3Database,
  Sqlite3Static
} from '@sqlite.org/sqlite-wasm';

import { convertKeysToNamedParams, isObject, parseArgs } from './helpers';
import type { Database, Statement, StatementArgs } from './index';

// Types for sqlite-wasm
// type Sqlite3Stmt = {
//   bind: (args: unknown[]) => void;
//   free: () => void;
//   get: (args: unknown[]) => unknown[];
//   getColumnNames: () => string[];
//   reset: () => void;
//   step: () => boolean;
// };

// type Sqlite3 = {
//   capi: {
//     sqlite3_changes: (pointer: number) => bigint;
//     sqlite3_js_db_export: (pointer: number) => Uint8Array;
//     sqlite3_last_insert_rowid: (pointer: number) => bigint;
//     sqlite3_trace_v2: (
//       pointer: number,
//       mask: number,
//       callback: number,
//       context: number
//     ) => void;
//   };
//   config: {
//     error: (errCode: number, msg: string) => void;
//   };
//   oo1: {
//     DB: new (path: string, mode: string) => unknown;
//   };
// };

// type Sqlite3DB = {
//   close: () => void;
//   exec: (sql: string) => void;
//   pointer: number;
//   prepare: (sql: string) => Sqlite3Stmt;
//   selectArray: (sql: string) => unknown[];
//   selectArrays: (sql: string) => unknown[][];
//   selectObjects: (sql: string) => unknown[];
//   selectValue: (sql: string) => number;
// };

// Wrapper for SQLite WASM database
export class WasmDatabaseWrapper implements Database {
  private db: Sqlite3Database;
  private sqlite3: Sqlite3Static;

  constructor(db: Sqlite3Database, sqlite3: Sqlite3Static) {
    this.db = db;
    this.sqlite3 = sqlite3;
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.db.prepare(sql);
    return {
      all: (args?: StatementArgs) => {
        stmt.reset();
        // console.log('all', sql, args);
        stmt.bind(args as unknown as BindingSpec);
        const results: unknown[] = [];
        while (stmt.step()) {
          results.push(stmt.get([]));
        }
        return results;
      },

      finalize: () => {
        throw new Error('Method not implemented.');
      },
      get: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        // console.log('get', sql, args);
        stmt.reset();
        if (args) {
          stmt.bind(args as unknown as BindingSpec);
        }
        if (stmt.step()) {
          const result = stmt.get({});
          // console.log('result', result);
          return result;
        }
        return null;
      },
      getColumnNames: () => {
        throw new Error('Method not implemented.');
      },
      run: (input?: StatementArgs, ...rest: StatementArgs[]) => {
        const args = parseArgs(input, ...rest);
        stmt.reset();
        if (args) {
          if (Array.isArray(args)) {
            stmt.bind(args as BindingSpec);
          } else if (isObject(args)) {
            // console.log('run', sql, args);
            stmt.bind(convertKeysToNamedParams(args) as BindingSpec);
          }
        }
        stmt.step();
        return {
          changes: this.changes(),
          lastInsertRowId: this.lastInsertRowId()
        };
      }
    };
  }

  changes(): number {
    return this.sqlite3.capi.sqlite3_changes(this.db) as number;
  }

  lastInsertRowId(): number {
    const rowid = this.sqlite3.capi.sqlite3_last_insert_rowid(
      this.db
    ) as bigint;

    // Check if it's within JS safe integer range
    if (rowid > Number.MAX_SAFE_INTEGER || rowid < Number.MIN_SAFE_INTEGER) {
      throw new Error(
        `Rowid ${rowid} is outside the safe JS integer range. Use BigInt instead.`
      );
    }

    return Number(rowid);
  }

  saveToPath(path: string) {
    const binary = this.sqlite3.capi.sqlite3_js_db_export(this.db);
    Bun.write(path, binary);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
}

// Factory function for SQLite WASM
export const createWasmDatabaseInstance = async (
  path: string,
  enableTracing: boolean = false
): Promise<Database> => {
  const sqliteWasm = await import('@sqlite.org/sqlite-wasm');
  const sqlite3 = await sqliteWasm.default({
    print: () => {},
    printErr: () => {}
  });

  let flags = 'c';
  if (enableTracing) {
    flags += 't';
  }

  const db = new sqlite3.oo1.DB(path, flags);

  if (!enableTracing) {
    // @ts-expect-error - sqlite3_trace_v2 claims 3 args, but it's actually 4
    sqlite3.capi.sqlite3_trace_v2(db, 0, null, 0);
  }

  sqlite3.config.error = (errCode: number, msg: string) => {
    // Suppress or redirect SQLite error logs
    // console.warn('SQLite error:', errCode, msg);
  };

  return new WasmDatabaseWrapper(db, sqlite3);
};
